import { encoding_for_model } from "@dqbd/tiktoken";

const enc = encoding_for_model("gpt-4");

export function countTokens(text) {
  const tokens = enc.encode(text);
  return tokens.length;
}
