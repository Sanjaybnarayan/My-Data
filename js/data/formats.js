/**
 * Format checks for the identifiers this application actually stores.
 *
 * A regex that only counts characters is worse than no check: it passes
 * transposed digits, which is exactly the mistake people make typing a
 * twelve-digit number off a card. Where the identifier carries a checksum,
 * the checksum is verified.
 */

/** Aadhaar's check digit is Verhoeff, which catches every single-digit error
 *  and every adjacent transposition — the two failure modes of hand entry. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeff(digits) {
  let c = 0;
  const reversed = String(digits).split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    const d = Number(reversed[i]);
    if (!Number.isInteger(d)) return false;
    c = D[c][P[i % 8][d]];
  }
  return c === 0;
}

const strip = (v) => String(v ?? '').replace(/[\s-]/g, '').toUpperCase();

export const formats = {
  PAN: {
    label: 'PAN',
    // Fourth character encodes holder type, fifth the surname initial.
    test: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(strip(v)),
    message: 'PAN must be five letters, four digits, then a letter (ABCDE1234F).',
    normalise: strip,
  },
  Aadhaar: {
    label: 'Aadhaar',
    test: (v) => {
      const s = strip(v);
      // Aadhaar never begins 0 or 1 — those ranges are reserved.
      return /^[2-9][0-9]{11}$/.test(s) && verhoeff(s);
    },
    message: 'That is not a valid Aadhaar number — check for a mistyped digit.',
    normalise: (v) => strip(v).replace(/(\d{4})(?=\d)/g, '$1 ').trim(),
  },
  IFSC: {
    label: 'IFSC',
    test: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(strip(v)),
    message: 'IFSC is four letters, a zero, then six characters (HDFC0001234).',
    normalise: strip,
  },
  GSTIN: {
    label: 'GSTIN',
    test: (v) => /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(strip(v)),
    message: 'GSTIN must be 15 characters in the standard pattern.',
    normalise: strip,
  },
  UPI: {
    label: 'UPI ID',
    test: (v) => /^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/.test(String(v ?? '').trim()),
    message: 'A UPI ID looks like name@bank.',
    normalise: (v) => String(v ?? '').trim().toLowerCase(),
  },
  Passport: {
    label: 'Passport',
    test: (v) => /^[A-Z][0-9]{7}$/.test(strip(v)),
    message: 'An Indian passport number is a letter followed by seven digits.',
    normalise: strip,
  },
  'Voter ID': {
    label: 'Voter ID',
    test: (v) => /^[A-Z]{3}[0-9]{7}$/.test(strip(v)),
    message: 'A voter ID (EPIC) is three letters followed by seven digits.',
    normalise: strip,
  },
  'Driving licence': {
    label: 'Driving licence',
    // State code, RTO code, year, serial — spacing and hyphens vary by state.
    test: (v) => /^[A-Z]{2}[0-9]{2}\s?(19|20)[0-9]{2}[0-9]{7}$/.test(strip(v)),
    message: 'A licence number is like KA01 20191234567.',
    normalise: strip,
  },
  vehicleRegistration: {
    label: 'Registration number',
    test: (v) => /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(strip(v)),
    message: 'A registration number is like KA01AB1234.',
    normalise: strip,
  },
  email: {
    label: 'Email',
    test: (v) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(v ?? '').trim()),
    message: 'That does not look like an email address.',
    normalise: (v) => String(v ?? '').trim().toLowerCase(),
  },
  phone: {
    label: 'Phone',
    test: (v) => {
      const s = String(v ?? '').replace(/[\s()-]/g, '');
      return /^\+?[0-9]{7,15}$/.test(s);
    },
    message: 'A phone number is 7 to 15 digits, optionally with a country code.',
    normalise: (v) => String(v ?? '').replace(/[\s()-]/g, ''),
  },
  url: {
    label: 'Link',
    test: (v) => {
      const s = String(v ?? '').trim();
      if (!s) return true;
      try {
        const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
        // javascript: and data: in a stored link become an XSS vector the
        // moment something renders it as an anchor.
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    },
    message: 'Enter a http or https address.',
    normalise: (v) => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
    },
  },
};

/** Format matching an identity document kind, if one is known. */
export function formatForDocumentKind(kind) {
  return formats[kind] ?? null;
}
