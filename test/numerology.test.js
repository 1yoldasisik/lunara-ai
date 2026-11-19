"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const {calculateNumerology,validateBirthDate,reduceNumber,normalizeName}=require("../lib/numerology");
test("date checks: leap day, impossible and future",()=>{assert.equal(validateBirthDate("2000-02-29",new Date("2026-11-19")),true);assert.equal(validateBirthDate("2001-02-29"),false);assert.equal(validateBirthDate("2030-01-01",new Date("2026-11-19")),false);});
test("master values preserved",()=>{for(const n of [11,22,33])assert.equal(reduceNumber(n).value,n);});
test("karmic compound indicators retained",()=>{for(const n of [13,14,16,19])assert.equal(reduceNumber(n).karmicDebt,n);});
test("Turkish characters normalized",()=>assert.equal(normalizeName("Çağla Güneş"),"CAGLA GUNES"));
test("letter mapping cycles Pythagorean 1-9",()=>{const x=calculateNumerology("AZ","2000-01-01",2026);assert.equal(x.letterValues[0].value,1);assert.equal(x.letterValues[1].value,8);});
test("transparent breakdown and year are returned",()=>{const x=calculateNumerology("Ada Lovelace","1815-12-10",2026);assert.equal(x.calculationYear,2026);assert.ok(x.lifePathBreakdown);assert.ok(x.expressionBreakdown.rawTotal>0);assert.ok(x.soulUrgeBreakdown.vowels.length>0);assert.equal(x.personalYearBreakdown.year,2026);});
test("invalid name rejected",()=>assert.throws(()=>calculateNumerology("A","2000-01-01",2026),/en az iki harf/));
