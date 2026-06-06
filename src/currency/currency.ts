export const PRESENTMENT_CURRENCIES = [
  "aed",
  "all",
  "amd",
  "aoa",
  "ars",
  "aud",
  "awg",
  "azn",
  "bam",
  "bbd",
  "bdt",
  "bif",
  "bmd",
  "bnd",
  "bob",
  "brl",
  "bsd",
  "bwp",
  "bzd",
  "cad",
  "cdf",
  "chf",
  "clp",
  "cny",
  "cop",
  "crc",
  "cve",
  "czk",
  "djf",
  "dkk",
  "dop",
  "dzd",
  "egp",
  "etb",
  "eur",
  "fjd",
  "fkp",
  "gbp",
  "gel",
  "gip",
  "gmd",
  "gnf",
  "gtq",
  "gyd",
  "hkd",
  "hnl",
  "htg",
  "huf",
  "idr",
  "ils",
  "inr",
  "isk",
  "jmd",
  "jpy",
  "kes",
  "kgs",
  "khr",
  "kmf",
  "krw",
  "kyd",
  "kzt",
  "lak",
  "lkr",
  "lrd",
  "lsl",
  "mad",
  "mdl",
  "mga",
  "mkd",
  "mnt",
  "mop",
  "mur",
  "mvr",
  "mwk",
  "mxn",
  "myr",
  "mzn",
  "nad",
  "ngn",
  "nio",
  "nok",
  "npr",
  "nzd",
  "pab",
  "pen",
  "pgk",
  "php",
  "pkr",
  "pln",
  "pyg",
  "qar",
  "ron",
  "rsd",
  "rwf",
  "sar",
  "sbd",
  "scr",
  "sek",
  "sgd",
  "shp",
  "sos",
  "srd",
  "szl",
  "thb",
  "tjs",
  "top",
  "try",
  "ttd",
  "twd",
  "tzs",
  "uah",
  "ugx",
  "usd",
  "uyu",
  "uzs",
  "vnd",
  "vuv",
  "wst",
  "xaf",
  "xcd",
  "xcg",
  "xof",
  "xpf",
  "yer",
  "zar",
  "zmw",
] as const;

export type PresentmentCurrency = typeof PRESENTMENT_CURRENCIES[number];
export type CurrencyAmountInput = string | number | bigint;

const PRESENTMENT_CURRENCY_SET: ReadonlySet<string> = new Set(PRESENTMENT_CURRENCIES);

const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export const normalizeCurrency = (currency: string): PresentmentCurrency => {
  const normalized = currency.trim().toLowerCase();
  if (!PRESENTMENT_CURRENCY_SET.has(normalized)) {
    throw new Error(`Unsupported Polar presentment currency '${currency}'.`);
  }
  return normalized as PresentmentCurrency;
};

export const currencyDecimalFactor = (currency: string): "1" | "100" =>
  ZERO_DECIMAL_CURRENCIES.has(normalizeCurrency(currency)) ? "1" : "100";

type DecimalParts = {
  readonly whole: string;
  readonly fraction: string;
};

const decimalPattern = /^(?:\+)?(?:(\d+)(?:\.(\d*))?|\.(\d+))$/;

const inputToText = (input: CurrencyAmountInput): string => {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new Error(`Currency amount must be finite, got '${String(input)}'.`);
    }
  }
  return String(input).trim();
};

const stripLeadingZeroes = (value: string): string => {
  const stripped = value.replace(/^0+(?=\d)/, "");
  return stripped === "" ? "0" : stripped;
};

const stripTrailingZeroes = (value: string): string => value.replace(/0+$/, "");

const parseNonNegativeDecimal = (input: CurrencyAmountInput): DecimalParts => {
  const text = inputToText(input);
  if (text.startsWith("-")) {
    throw new Error(`Currency amount must be non-negative, got '${text}'.`);
  }

  const match = decimalPattern.exec(text);
  if (match === null) {
    throw new Error(`Currency amount must be a decimal string without exponent notation, got '${text}'.`);
  }

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? match[3] ?? "";
  return {
    whole: stripLeadingZeroes(whole),
    fraction,
  };
};

const formatDecimal = ({ whole, fraction }: DecimalParts): string => {
  const canonicalWhole = stripLeadingZeroes(whole);
  const canonicalFraction = stripTrailingZeroes(fraction);
  return canonicalFraction === "" ? canonicalWhole : `${canonicalWhole}.${canonicalFraction}`;
};

const shiftDecimalRight = (input: CurrencyAmountInput, places: number): DecimalParts => {
  const parts = parseNonNegativeDecimal(input);
  const digits = `${parts.whole}${parts.fraction}`;
  const decimalIndex = parts.whole.length + places;

  if (decimalIndex >= digits.length) {
    return {
      whole: stripLeadingZeroes(`${digits}${"0".repeat(decimalIndex - digits.length)}`),
      fraction: "",
    };
  }

  return {
    whole: stripLeadingZeroes(digits.slice(0, decimalIndex)),
    fraction: digits.slice(decimalIndex),
  };
};

const shiftDecimalLeft = (input: CurrencyAmountInput, places: number): DecimalParts => {
  const parts = parseNonNegativeDecimal(input);
  const digits = `${parts.whole}${parts.fraction}`;
  const decimalIndex = parts.whole.length - places;

  if (decimalIndex <= 0) {
    return {
      whole: "0",
      fraction: `${"0".repeat(Math.abs(decimalIndex))}${digits}`,
    };
  }

  return {
    whole: stripLeadingZeroes(digits.slice(0, decimalIndex)),
    fraction: digits.slice(decimalIndex),
  };
};

const assertIntegerDecimal = (amount: DecimalParts, source: CurrencyAmountInput): string => {
  if (/[^0]/.test(amount.fraction)) {
    throw new Error(`Currency amount '${String(source)}' cannot be represented as integer minor units.`);
  }
  return stripLeadingZeroes(amount.whole);
};

const decimalFactorPlaces = (currency: string): 0 | 2 => currencyDecimalFactor(currency) === "1" ? 0 : 2;

export const majorToMinorUnitAmount = (
  amount: CurrencyAmountInput,
  currency: string,
): string => assertIntegerDecimal(shiftDecimalRight(amount, decimalFactorPlaces(currency)), amount);

export const optionalMajorToMinorUnitAmount = (
  amount: CurrencyAmountInput | null | undefined,
  currency: string,
): string | null => amount == null ? null : majorToMinorUnitAmount(amount, currency);

export const minorToMajorUnitAmount = (
  amount: CurrencyAmountInput,
  currency: string,
): string => formatDecimal(shiftDecimalLeft(amount, decimalFactorPlaces(currency)));

export const optionalMinorToMajorUnitAmount = (
  amount: CurrencyAmountInput | null | undefined,
  currency: string,
): string | null => amount == null ? null : minorToMajorUnitAmount(amount, currency);

export type FormatCurrencyAmountOptions = {
  readonly locale?: Intl.LocalesArgument;
  readonly currencyDisplay?: Intl.NumberFormatOptions["currencyDisplay"];
};

const decimalFractionDigits = (amount: string): number => amount.split(".")[1]?.length ?? 0;

export const formatMajorUnitAmount = (
  amount: CurrencyAmountInput,
  currency: string,
  options: FormatCurrencyAmountOptions = {},
): string => {
  const normalizedCurrency = normalizeCurrency(currency);
  const majorAmount = formatDecimal(parseNonNegativeDecimal(amount));
  const currencyCode = normalizedCurrency.toUpperCase();
  const defaults = new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: options.currencyDisplay ?? "symbol",
  }).resolvedOptions();

  const minimumFractionDigits = defaults.minimumFractionDigits ?? 0;
  const maximumFractionDigits = defaults.maximumFractionDigits ?? minimumFractionDigits;

  return new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: options.currencyDisplay ?? "symbol",
    minimumFractionDigits,
    maximumFractionDigits: Math.max(maximumFractionDigits, decimalFractionDigits(majorAmount)),
  }).format(Number(majorAmount));
};

export const formatMinorUnitAmount = (
  amount: CurrencyAmountInput,
  currency: string,
  options: FormatCurrencyAmountOptions = {},
): string => formatMajorUnitAmount(minorToMajorUnitAmount(amount, currency), currency, options);

export const polarIntegerMinorUnitAmount = (
  amount: CurrencyAmountInput,
  currency: string,
): string => {
  normalizeCurrency(currency);
  return assertIntegerDecimal(parseNonNegativeDecimal(amount), amount);
};

export const optionalPolarIntegerMinorUnitAmount = (
  amount: CurrencyAmountInput | null | undefined,
  currency: string,
): string | null => amount == null ? null : polarIntegerMinorUnitAmount(amount, currency);

export const majorToMinorUnitDecimalAmount = (
  amount: CurrencyAmountInput,
  currency: string,
): string => formatDecimal(shiftDecimalRight(amount, decimalFactorPlaces(currency)));

export const polarDecimalMinorUnitAmount = (
  amount: CurrencyAmountInput,
  currency: string,
): string => {
  normalizeCurrency(currency);
  return formatDecimal(parseNonNegativeDecimal(amount));
};

export const polarIntegerMinorUnitNumber = (
  amount: CurrencyAmountInput,
  currency: string,
): number => {
  const normalized = polarIntegerMinorUnitAmount(amount, currency);
  const value = BigInt(normalized);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Currency amount '${normalized}' exceeds JavaScript's safe integer range.`);
  }
  return Number(value);
};

export const optionalPolarIntegerMinorUnitNumber = (
  amount: CurrencyAmountInput | null | undefined,
  currency: string,
): number | null => amount == null ? null : polarIntegerMinorUnitNumber(amount, currency);
