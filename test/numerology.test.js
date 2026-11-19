"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateNumerology, validateBirthDate, reduceNumber, normalizeName, sumDigits } = require("../lib/numerology");

test("valid calendar dates, leap day and future dates", () => {
  assert.equal(validateBirthDate("2000-02-29", new Date("2026-11-19")), true);
  assert.equal(validateBirthDate("1900-02-29", new Date("2026-11-19")), false);
  assert.equal(validateBirthDate("2001-02-29", new Date("2026-11-19")), false);
  assert.equal(validateBirthDate("2026-11-20", new Date("2026-11-19")), false);
  assert.equal(validateBirthDate("0000-01-01"), false);
  assert.equal(validateBirthDate("2026-13-01"), false);
});

test("master numbers are preserved while other values reduce", () => {
  for (const n of [11, 22, 33]) assert.equal(reduceNumber(n).value, n);
  assert.equal(reduceNumber(29).value, 11);
  assert.equal(reduceNumber(38).value, 11);
  assert.equal(reduceNumber(44).value, 8);
});

test("karmic debt numbers detected in reduction chain", () => {
  for (const n of [13, 14, 16, 19]) assert.equal(reduceNumber(n).karmicDebt, n);
  assert.equal(reduceNumber(25).karmicDebt, null);
});

test("Turkish characters normalized and letter cycle verified", () => {
  assert.equal(normalizeName("Çağla Güneş"), "CAGLA GUNES");
  const values = calculateNumerology("AZ", "2000-01-01", 2026).letterValues;
  assert.equal(values[0].value, 1);
  assert.equal(values[1].value, 8);
});

test("Life Path total digit sum and traceability", () => {
  const result = calculateNumerology("Ada Lovelace", "1815-12-10", 2026);
  assert.equal(result.lifePathBreakdown.digitSum, sumDigits("1815-12-10"));
  assert.equal(result.lifePath, reduceNumber(sumDigits("1815-12-10")).value);
  assert.ok(result.expressionBreakdown.rawTotal > 0);
});

test("Personal Year uses target year digit sum", () => {
  const result = calculateNumerology("Ada Lovelace", "1815-12-10", 2026);
  assert.equal(result.personalYearBreakdown.yearDigitTotal, 10);
  assert.equal(result.personalYearBreakdown.rawTotal, 12 + 10 + 10);
  assert.equal(result.personalYear, reduceNumber(32).value);
});

test("vowels and consonants are separated and totals reconcile", () => {
  const result = calculateNumerology("Ada Lovelace", "1815-12-10", 2026);
  assert.equal(result.expressionBreakdown.rawTotal,
    result.soulUrgeBreakdown.rawTotal + result.personalityBreakdown.rawTotal);
  assert.ok(result.soulUrgeBreakdown.vowels.length);
  assert.ok(result.personalityBreakdown.consonants.length);
});

test("invalid name and calculation year rejected", () => {
  assert.throws(() => calculateNumerology("A", "2000-01-01", 2026), /en az iki harf/);
  assert.throws(() => calculateNumerology("Ada Lovelace", "2000-01-01", 0), /hesaplama yılı/);
});
