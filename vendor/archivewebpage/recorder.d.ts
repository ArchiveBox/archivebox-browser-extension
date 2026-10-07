export class Recorder {
  [key: string]: any;
  constructor();
  attach(): Promise<void>;
  detach(): Promise<void>;
  send(method: string, params?: any, sessions?: string[]): Promise<any>;
  processMessage(method: string, params: any, sessions?: string[]): Promise<void>;
  fullCommit(reqresp: any, sessions: string[]): Promise<void>;
}
