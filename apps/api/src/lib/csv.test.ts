import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("writes header + rows with CRLF and a trailing newline", () => {
    expect(toCsv(["a", "b"], [[1, 2], [3, 4]])).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("quotes fields containing a comma, quote, or newline and doubles quotes", () => {
    const out = toCsv(["name", "note"], [["Acme, Inc.", 'say "hi"'], ["multi\nline", "ok"]]);
    expect(out).toBe('name,note\r\n"Acme, Inc.","say ""hi"""\r\n"multi\nline",ok\r\n');
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, 0]])).toBe("a,b,c\r\n,,0\r\n");
  });
});
