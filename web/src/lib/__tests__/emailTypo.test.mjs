import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, suggestEmail } from "../emailTypo.ts";

test("common domain typos get a suggestion", () => {
  const cases = {
    "name@gmail.coma": "name@gmail.com",
    "name@gmial.com": "name@gmail.com",
    "name@gmail.con": "name@gmail.com",
    "name@gmai.com": "name@gmail.com",
    "name@gnail.com": "name@gmail.com",
    "name@yahoo.co": "name@yahoo.com",
    "name@yaho.com": "name@yahoo.com",
    "name@hotmail.cm": "name@hotmail.com",
    "name@hotmial.com": "name@hotmail.com",
    "name@outlook.co": "name@outlook.com",
    "name@outlok.com": "name@outlook.com",
    "name@icloud.con": "name@icloud.com",
    "name@rediffmail.co": "name@rediffmail.com",
    "name@gmail.cmoo": "name@gmail.com",
  };
  for (const [typo, fixed] of Object.entries(cases)) assert.equal(suggestEmail(typo), fixed, typo);
});

test("keeps the local part exactly and trims whitespace", () => {
  assert.equal(suggestEmail("  Priya.K+bv@GMAIL.CON "), "Priya.K+bv@gmail.com");
});

test("no suggestion for correct, real or unrelated domains", () => {
  for (const ok of [
    "name@gmail.com",
    "name@yahoo.co.in",
    "name@ymail.com",
    "name@me.com",
    "name@mac.com",
    "name@mail.com",
    "name@googlemail.com",
    "name@3pandalabs.com",
    "name@company.in",
    "name@iitb.ac.in",
  ]) {
    assert.equal(suggestEmail(ok), null, ok);
  }
});

test("unparseable input gives no suggestion", () => {
  for (const bad of ["", "name", "@gmail.con", "name@", "name@gmail"]) assert.equal(suggestEmail(bad), null, bad);
});

test("editDistance counts a transposition as one edit", () => {
  assert.equal(editDistance("gmial", "gmail"), 1);
  assert.equal(editDistance("gmail.coma", "gmail.com"), 1);
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("", "abc"), 3);
});
