import { describe, expect, it } from "vitest";
import { uniqueContactParticipants } from "@/components/contact-participants";

describe("uniqueContactParticipants", () => {
  it("deduplicates From, To, and Cc addresses case-insensitively", () => {
    const participants = uniqueContactParticipants(
      { name: "Sender", address: " Sender@example.com " },
      [
        { name: "Sender duplicate", address: "sender@EXAMPLE.com" },
        { name: "Destination", address: "destination@example.com" },
      ],
      [
        { name: "Destination duplicate", address: "DESTINATION@example.com" },
        { name: "Copy", address: "copy@example.com" },
      ],
    );

    expect(participants).toEqual([
      { name: "Sender", address: "Sender@example.com" },
      { name: "Destination", address: "destination@example.com" },
      { name: "Copy", address: "copy@example.com" },
    ]);
  });

  it("drops participants with empty addresses", () => {
    expect(uniqueContactParticipants(
      { name: "Missing", address: " " },
      [{ name: "Valid", address: "valid@example.com" }],
      [],
    )).toEqual([{ name: "Valid", address: "valid@example.com" }]);
  });
});
