import {expect, test} from "bun:test";
import {canonicalRfcMessageId, deriveReplyHeaders, replyMailboxes, type ReplyParent} from "./reply-headers.js";
const parent: ReplyParent = {direction:"inbound",from_addr:"sender@example.com",to_addrs:["me@example.com"],cc_addrs:[],subject:"Topic",message_id:"<parent@example.net>",in_reply_to:null,headers:{References:"<root@example.net>"}};
test("RFC reply ancestry appends actual parent identity and preserves case", () => {
 expect(deriveReplyHeaders(parent,"me@example.com","Re: Topic")).toEqual({"In-Reply-To":"<parent@example.net>",References:"<root@example.net> <parent@example.net>"});
 expect(deriveReplyHeaders({...parent,headers:{"Message-ID":"<Parent@Example.net>"},message_id:null,in_reply_to:"<root@example.net>"},"me@example.com","Topic").References).toBe("<root@example.net> <Parent@Example.net>");
});
test("reply authorization and identity failures cannot create fabricated transport headers", () => {
 for(const [patch,from,subject,reason] of [
  [{},"other@example.com","Topic","reply_sender_mismatch"],
  [{},"me@example.com","Different","reply_subject_mismatch"],
  [{message_id:"provider-opaque-id"},"me@example.com","Topic","reply_parent_message_id_unavailable"],
  [{headers:{"message-id":"<different@example.net>"}},"me@example.com","Topic","reply_parent_identity_conflict"],
  [{headers:{References:"<root@example.net>\r\nBcc: hidden@example.net"}},"me@example.com","Topic","reply_parent_references_invalid"],
  [{headers:{References:"x".repeat(901)}},"me@example.com","Topic","reply_parent_references_invalid"],
 ] as const) { try { deriveReplyHeaders({...parent,...patch},from,subject); throw Error("Expected refusal"); } catch(e) { expect((e as {reason?:string}).reason).toBe(reason); } }
 expect(deriveReplyHeaders({...parent,direction:"outbound"},"sender@example.com","Re: Topic")["In-Reply-To"]).toBe("<parent@example.net>");
});
test("mailbox parsing preserves quoted display commas and rejects injected or ambiguous values", () => {
 expect(replyMailboxes('"Doe, Jane" <Jane@example.com>, second@example.com')).toEqual(["jane@example.com","second@example.com"]);
 for (const value of ["a@example.com\r\nBcc: b@example.com",'"unclosed <a@example.com>',"a@example.com,",null,{}]) expect(replyMailboxes(value)).toBeNull();
 for(const value of ["opaque-provider-id","<a@b> <c@d>","a@b\r\nX: y","<a@b"] ) expect(canonicalRfcMessageId(value)).toBeNull();
});

test("present malformed transport headers refuse instead of dropping evidence", () => {
 for(const headers of [{References:"<one@x>",references:"<two@x>"},{References:["<one@x>"]},{References:""},{"Message-ID":"<one@x>","message-id":"<two@x>"},{"Message-ID":42},{"Message-ID":"<bad;id@example.com>"},{"In-Reply-To":["<one@x>"]}]) {
  expect(() => deriveReplyHeaders({...parent,headers},"me@example.com","Topic")).toThrow();
 }
});
test("RFC Message-ID accepts modern dot atoms and domain literals, not arbitrary punctuation", () => {
 for(const id of ["<bad;id@example.com>","<.bad@example.com>","<bad..id@example.com>","<bad@.example.com>","<bad@example..com>"]) expect(canonicalRfcMessageId(id)).toBeNull();
 for(const id of ["<CA+reply.id@Mail.Example>","<id@[127.0.0.1]>","<id@[IPv6:2001:db8::1]>"]) expect(canonicalRfcMessageId(id)).toBe(id);
});
