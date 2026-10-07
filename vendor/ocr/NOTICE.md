# Browser document extraction

The LiteParse plugin calls these upstream packages directly; no PDF parser or OCR algorithm is reimplemented here:

- [`@llamaindex/liteparse-wasm` 2.15.1](https://github.com/run-llama/liteparse/tree/main/packages/wasm), Apache-2.0. The Rust/PDFium parser supplies layout, native text, metadata, annotations, blocks and OCR page rendering. Its documented `ocrEngine.recognize(PNG, width, height, language)` callback calls PaddleOCR. Images and screenshots are disabled in returned results; temporary OCR rasters never enter the archive.
- [`@paddleocr/paddleocr-js` 0.4.2](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js), Apache-2.0 (`PADDLE-LICENSE`). PP-OCRv5 mobile detection/recognition models are pinned below. ONNX Runtime Web 1.30.0 (MIT) and the SDK's OpenCV.js bindings run locally. Paddle's upstream line polygons become text-region boxes and confidence values, not invented word boxes. PDF positions/word boxes come from LiteParse.

The WXT build and standalone HTTP player bundle the same engines and local models. ONNX's official `onnxruntime-web-use-extern-wasm` export condition avoids embedding a second copy of its binary. Only the configured JSEP runtime is copied. Neither parsing nor model initialization needs a CDN or original-site request.

The final capture stage parses original PDFs and images after acquisition drains.
Saved LiteParse JSON retains text and layout once under the plugin folder and
feeds the search index. Cards and full viewers read those results; they do not
start an OCR runtime. TXT downloads are generated from the saved text.

`entrypoints/ocr-sandbox/main.ts` runs generated upstream OpenCV/ONNX bindings in an opaque extension sandbox without extension APIs. The parent accepts replies only from its own frame with the matching job id. Jobs are serialized and bounded by `LITEPARSE_TIMEOUT`; failure/abort removes the frame. Original PDF/image bytes stay in WARC, including originals inside provider ZIPs. Generated OCR JSON is stored separately, without another input copy or temporary rasterized page.

## Model provenance

Downloaded October 3, 2026, without modification from Paddle's official model repository:

| Local file under `public/ocr/models` | Official URL | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `PP-OCRv5_mobile_det.tar` | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar | 4843520 | `781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30` |
| `PP-OCRv5_mobile_rec.tar` | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar | 16701440 | `f7e792bc836f36e7ef895ad47c426d75b0b75b1650caa6d63fe9418441ffba8c` |

The model vocabulary is fixed by this upstream model; this is not a claim of OCR accuracy/language parity with every native backend. Browser-decodable image formats and PDFs are supported. Office conversion, handwriting/VLM OCR, automatic language-model downloads and Chrome Prompt API inference are not implemented.

Chrome's [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) accepts images, but availability must be checked for the exact input/output modalities. A fresh Brave 153 profile reported `unavailable` for image + English-text input. We do not treat an existing `LanguageModel` symbol as a working OCR backend. Scribe.js and browser VLMs remain candidates for an actual comparative quality benchmark.
