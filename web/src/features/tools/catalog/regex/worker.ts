import { executeRegexMatches, type RegexExecResult } from './logic';

export interface RegexWorkerRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
}

export interface RegexWorkerResponse {
  id: number;
  result: RegexExecResult;
}

self.onmessage = (ev: MessageEvent<RegexWorkerRequest>) => {
  const { id, pattern, flags, text } = ev.data;
  const result = executeRegexMatches(pattern, flags, text);
  const reply: RegexWorkerResponse = { id, result };
  self.postMessage(reply);
};
