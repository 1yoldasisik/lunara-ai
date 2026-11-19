"use strict";

const MASTER = [11, 22, 33];
const KARMIC_DEBT = [13, 14, 16, 19];

function reduceNumber(value) {
  let n = Math.abs(Number(value));
  if (!Number.isFinite(n)) throw new TypeError("Sayı geçerli olmalıdır.");
  const steps = [n];
  while (n > 9 && !MASTER.includes(n)) {
    n = String(n).split("").reduce((sum, digit) => sum + Number(digit), 0);
    steps.push(n);
  }
  return {
    value: n,
    steps,
    compound: steps.find((v) => v > 9) ?? null,
    karmicDebt: steps.find((v) => KARMIC_DEBT.includes(v)) ?? null
  };
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ç/g, "C").replace(/Ğ/g, "G").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ş/g, "S").replace(/Ü/g, "U");
}

function validateBirthDate(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return date <= today;
}

function sumDigits(value) {
  return String(value).replace(/[^0-9]/g, "").split("").reduce((sum, digit) => sum + Number(digit), 0);
}

function letterValue(letter) {
  return ((letter.charCodeAt(0) - 65) % 9) + 1;
}

function calculateNumerology(fullName, birthDate, calculationYear = new Date().getFullYear()) {
  if (!validateBirthDate(birthDate)) throw Object.assign(new Error("Geçerli bir doğum tarihi girin."), { status: 400 });
  if (!Number.isInteger(calculationYear) || calculationYear < 1 || calculationYear > 9999)
    throw Object.assign(new Error("Geçerli bir hesaplama yılı girin."), { status: 400 });

  const name = normalizeName(fullName);
  const letters = name.match(/[A-Z]/g) || [];
  if (letters.length < 2) throw Object.assign(new Error("Ad ve soyad alanında en az iki harf bulunmalıdır."), { status: 400 });

  const letterValues = letters.map((letter) => ({ letter, value: letterValue(letter) }));
  const vowels = letterValues.filter((item) => "AEIOU".includes(item.letter));
  const consonants = letterValues.filter((item) => !"AEIOU".includes(item.letter));
  const expressionRaw = letterValues.reduce((sum, item) => sum + item.value, 0);
  const soulRaw = vowels.reduce((sum, item) => sum + item.value, 0);
  const personalityRaw = consonants.reduce((sum, item) => sum + item.value, 0);
  const [birthYear, month, day] = birthDate.split("-").map(Number);

  // Digit-sum reduction of the complete date; this is a widely used Life Path convention.
  const lifePathRaw = sumDigits(birthDate);
  const lifePath = reduceNumber(lifePathRaw);
  const birthday = reduceNumber(day);
  const expression = reduceNumber(expressionRaw);
  const soulUrge = reduceNumber(soulRaw);
  const personality = reduceNumber(personalityRaw);

  // Personal Year: birth month + birth day + digit sum of the target year, then reduce.
  const yearDigitTotal = sumDigits(calculationYear);
  const personalYearRaw = month + day + yearDigitTotal;
  const personalYear = reduceNumber(personalYearRaw);

  const entries = [
    ["Life Path", lifePath], ["Birthday", birthday], ["Expression", expression],
    ["Soul Urge", soulUrge], ["Personality", personality], ["Personal Year", personalYear]
  ];
  const karmicDebtIndicators = entries.flatMap(([name, result]) =>
    result.steps.filter((step) => KARMIC_DEBT.includes(step)).map((number) => ({ indicator: name, number }))
  );
  const masterNumbers = [...new Set(entries.flatMap(([, result]) => result.steps.filter((step) => MASTER.includes(step))))];

  return {
    calculationYear,
    normalizedName: name,
    letterValues,
    lifePath: lifePath.value,
    lifePathBreakdown: { date: birthDate, digitSum: lifePathRaw, reduction: lifePath },
    birthday: birthday.value,
    birthdayBreakdown: { day, reduction: birthday },
    expression: expression.value,
    expressionBreakdown: { rawTotal: expressionRaw, reduction: expression, letters: letterValues },
    soulUrge: soulUrge.value,
    soulUrgeBreakdown: { rawTotal: soulRaw, reduction: soulUrge, vowels },
    personality: personality.value,
    personalityBreakdown: { rawTotal: personalityRaw, reduction: personality, consonants },
    personalYear: personalYear.value,
    personalYearBreakdown: { month, day, year: calculationYear, yearDigitTotal, rawTotal: personalYearRaw, reduction: personalYear },
    masterNumbers,
    karmicDebtNumbers: [...new Set(karmicDebtIndicators.map((item) => item.number))],
    karmicDebtIndicators,
    calculationMethod: "Pythagorean letter mapping; 1-9 digit cycle; 11/22/33 preserved; Life Path uses full-date digit sum; Personal Year uses birth month + birth day + target-year digit sum; AEIOU vowels and Y consonant."
  };
}

module.exports = { calculateNumerology, validateBirthDate, reduceNumber, normalizeName, sumDigits };
