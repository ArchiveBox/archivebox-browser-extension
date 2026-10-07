# type: ignore
from __future__ import annotations
from typing import *  # type: ignore

from pydantic import BaseModel
from functools import lru_cache, wraps
from tenacity import (
    retry,
    wait_random_exponential,
    stop_after_attempt,
    before_sleep_log,
)
import time
import logging

from .exceptions import AlreadyVisitedError, AlreadyFailedError
from .version import __version__

if TYPE_CHECKING:
    from requests import Response


class SessionOptions(BaseModel):
    timeout: float
    retries: int
    retry_sleep: float
    retry_sleep_multiplier: float
    warc_output: str
    user_agent: str
    get_urls: bool


class Session:
    def __init__(self, options: SessionOptions):
        self._warc_file = None

        if options.warc_output:
            from warcio.warcwriter import WARCWriter
            from warcio.capture_http import capture_http

            self._capture_http = capture_http
            self._warc_file = open(options.warc_output, "wb")
            self._warc_writer = WARCWriter(self._warc_file)

        # For the `warcio` recording to work, `requests` must be imported only after `capture_http`.
        import requests

        self._session = requests.Session()
        self._options = options
        self._cache: dict[
            tuple[str, frozenset[tuple[str, Any]], frozenset[tuple[str, Any]]],
            requests.Response,
        ] = {}
        self._past_requests: set[
            tuple[str, frozenset[tuple[str, Any]], frozenset[tuple[str, Any]]]
        ] = set()
        self._past_failed_requests: set[
            tuple[str, frozenset[tuple[str, Any]], frozenset[tuple[str, Any]]]
        ] = set()

        self.delay = 1
        self.attempts = 0

    def __del__(self):
        if self._warc_file:
            self._warc_file.close()

    def get(
        self,
        url: str,
        *,
        params: dict[str, Any] = {},
        headers: dict[str, Any] = {},
        should_cache: bool = False,
        should_retry: bool = True,
        **kwargs: Any,
    ):
        response = self.try_get(
            url,
            params=params,
            headers=headers,
            should_cache=should_cache,
            should_retry=should_retry,
            **kwargs,
        )
        response.raise_for_status()

        return response

    def try_get(
        self,
        url: str,
        *,
        params: dict[str, Any] = {},
        headers: dict[str, Any] = {},
        should_cache: bool = False,
        should_retry: bool = True,
        **kwargs: Any,
    ) -> Response:
        logging.debug(f"Attempting GET {url} {params} {headers}")

        frozen_params = frozenset(params.items())
        frozen_headers = frozenset(headers.items())

        if (url, frozen_params, frozen_headers) in self._cache:
            cached_response = self._cache[(url, frozen_params, frozen_headers)]

            if not should_cache:
                del self._cache[(url, frozen_params, frozen_headers)]

            return cached_response
        elif (url, frozen_params, frozen_headers) in self._past_requests:
            raise AlreadyVisitedError(url, frozen_params, frozen_headers)
        elif (url, frozen_params, frozen_headers) in self._past_failed_requests:
            raise AlreadyFailedError(url, frozen_params, frozen_headers)

        if should_retry:

            @retry(
                reraise=True,
                wait=wait_random_exponential(
                    multiplier=self._options.retry_sleep,
                    exp_base=self._options.retry_sleep_multiplier,
                ),
                stop=stop_after_attempt(self._options.retries),
                before_sleep=before_sleep_log(logging.getLogger(), logging.WARNING),
            )
            def retrying_get(
                url: str,
                *,
                params: dict[str, Any] = {},
                headers: dict[str, Any] = {},
                **kwargs: Any,
            ):
                return self._do_get(url, params=params, headers=headers, **kwargs)

            try:
                response = retrying_get(url, params=params, headers=headers, **kwargs)
            except:
                self._past_failed_requests.add((url, frozen_params, frozen_headers))
                raise
        else:
            response = self._do_get(url, params=params, headers=headers, **kwargs)

        if should_cache:
            self._cache[(url, frozen_params, frozen_headers)] = response
        else:
            self._past_requests.add((url, frozen_params, frozen_headers))

        return response

    def _after_retry(self):
        logging.warning(f"Waiting {self.delay} seconds.")

    def _do_get(
        self,
        url: str,
        *,
        params: dict[str, Any] = {},
        headers: dict[str, Any] = {},
        **kwargs: Any,
    ):
        if self._options.get_urls:
            print(url)
        else:
            logging.info(f"GET {url} {params} {headers}")

        if not headers:
            headers = {"User-Agent": self._options.user_agent}

        if self._warc_file:
            with self._capture_http(self._warc_writer):
                return self._session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=self._options.timeout,
                    **kwargs,
                )
        else:
            return self._session.get(
                url,
                params=params,
                headers=headers,
                timeout=self._options.timeout,
                **kwargs,
            )

    def validate_url(self, url: str):
        try:
            self._session.get_adapter(url)
        except:  # `InvalidSchema`, not referencing it directly to avoid breaking WARC recording.
            return False

        return True
