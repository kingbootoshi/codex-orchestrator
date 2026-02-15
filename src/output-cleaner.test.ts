import { describe, expect, test } from "bun:test";
import { cleanTerminalOutput, stripAnsiCodes } from "./output-cleaner.ts";

describe("stripAnsiCodes", () => {
  test("removes CSI and OSC sequences", () => {
    const input =
      "hello \u001b[31mred\u001b[0m world \u001b]8;;https://example.com\u0007link\u001b]8;;\u0007";
    expect(stripAnsiCodes(input)).toBe("hello red world link");
  });

  test("removes cursor and mode controls", () => {
    const input = "a\u001b[?25h\u001b[?2026l\u001b[2Kb";
    expect(stripAnsiCodes(input)).toBe("ab");
  });
});

describe("cleanTerminalOutput", () => {
  test("removes inline Codex chrome while keeping substantive content", () => {
    const input =
      "- Caveat: pgvector filtering behavior is still post-filtering inside the›Implement {feature}? for shortcuts46% context left\u001b[?25h\u001b[?2026l\n" +
      "•Searching the web\n";

    const cleaned = cleanTerminalOutput(input);
    expect(cleaned).toBe("- Caveat: pgvector filtering behavior is still post-filtering inside the");
  });

  test("drops redraw typing artifacts and keeps meaningful lines", () => {
    const input =
      "arg rc fchfo hior inr ng f g fi fil folt orte r er fr fi p ilpa ltat tett erte r er\n" +
      "- Searched https://github.com/pgvector/pgvector/issues/455\n";

    const cleaned = cleanTerminalOutput(input);
    expect(cleaned).toBe("- Searched https://github.com/pgvector/pgvector/issues/455");
  });

  test("normalizes leading bullet tool lines and removes worked-bar noise", () => {
    const input =
      "• Searched 'post filter' in https://github.com/pgvector/pgvector/issues/575\n" +
      "─ Worked for 1m 34s ────────────────────────────────────────────────────────────\n";

    const cleaned = cleanTerminalOutput(input);
    expect(cleaned).toBe("- Searched 'post filter' in https://github.com/pgvector/pgvector/issues/575");
  });
});
