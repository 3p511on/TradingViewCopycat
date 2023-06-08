type TArrayMinTwo = [string, string, ...string[]];

export const parseEntries = (str: string, delimiters: TArrayMinTwo = [',', ':']): string[][] =>
  str.split(delimiters[0]).map((line) => line.split(delimiters[1]));

export function parseSymbDict<T>(str: string, parseIntegers = false): ({ [name: string]: T }) {
  const entries = parseEntries(str, [',', ':']);
  const parsedEntries = entries.map(([key, value]) => {
    const defaultValue = parseIntegers ? 0 : value
    return [key, value && parseIntegers ? +value : defaultValue]
  })
  return Object.fromEntries(parsedEntries);
}

// TODO: Check decimals
// export function parsePercent(percent: string | number): number {
//   if (typeof percent === 'string') {
//     if (percent.endsWith('%')) percent = percent.slice(0, -1);
//     percent = +percent;
//   }
//   if (percent < 1) return percent;
//   return percent / 100;
// }

export function parsePercent(input: string | number): number {
  const inputTrimmed = input.toString().trim();
  const percentageSymbolIndex = inputTrimmed.indexOf('%');

  if (percentageSymbolIndex === -1) {
    const parsedNumber = parseFloat(inputTrimmed);
    return isNaN(parsedNumber) ? 0 : parsedNumber;
  } else {
    const percentageValue = parseFloat(inputTrimmed.slice(0, percentageSymbolIndex));
    return isNaN(percentageValue) ? 0 : percentageValue / 100;
  }
}

export function parseClosePercents(str: string): number[] {
  if (str === '') return [];
  return str.split(',').map(parsePercent);
}

export function parsePercentsDict(str: string): number[][] {
  if (str === '') return [];
  const rawEntries = parseEntries(str, [', ', ':']);
  const withPercents = rawEntries.map((entry) => entry.map(parsePercent));
  return withPercents;
}
