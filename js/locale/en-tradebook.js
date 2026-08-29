/**
 * English, for importing a tradebook.
 *
 * A separate file for the same reason as `en-signin.js`: `en.js` is the
 * catalogue and this is a block that changes with one feature. Splitting also
 * keeps `en.js` under the size the module-size ratchet holds it to, which is
 * what forced the first split too.
 *
 * Spread into `strings` rather than registered separately — two catalogues
 * for one language would be two things to keep in step, and `coverage()`
 * measures against one object.
 */

export const tradebookStrings = {
  'tradebook.title': 'Import a tradebook',
  'tradebook.intro': 'A CSV your broker lets you download \u2014 a tradebook, contract-note summary or transaction report. Every row becomes an investment transaction against a holding you already have.',
  'tradebook.notAConnector': 'This reads a file you downloaded. FamilyOS does not connect to any broker, and nothing here logs in on your behalf.',
  'tradebook.chooseFile': 'Choose a tradebook file',
  'tradebook.tooShort': 'That file has no rows under its headings.',
  'tradebook.mapTitle': 'Which column is which',
  'tradebook.mapBody': 'Guessed from the headings, and yours to correct. Nothing is read until you press Check.',
  'tradebook.rows': '{n} rows',
  'tradebook.required': 'needed',
  'tradebook.optional': 'optional',
  'tradebook.notInFile': 'not in this file',
  'tradebook.check': 'Check the file',
  'tradebook.startAgain': 'Choose another file',
  'tradebook.missingColumns': 'Still to be mapped: {fields}. A trade cannot be read without them.',
  'tradebook.planTitle': 'What this file holds',
  'tradebook.willImport': 'will be imported',
  'tradebook.alreadyHere': 'already recorded',
  'tradebook.noHolding': 'no matching holding',
  'tradebook.unreadable': 'could not be read',
  'tradebook.totalValue': 'Totalling {amount} across the rows that will be imported.',
  'tradebook.someDerived': '{n} of these had no total in the file; it was worked out from units \u00d7 price, before charges.',
  'tradebook.import': 'Import {n} trades',
  'tradebook.nothingToImport': 'Nothing in this file is new.',
  'tradebook.confirmTitle': 'Import these trades?',
  'tradebook.confirmBody': '{n} investment transactions will be added. Nothing else changes \u2014 no bank transaction is created, because money moving to a broker is not spending.',
  'tradebook.confirmYes': 'Import them',
  'tradebook.imported': '{n} trades imported.',
  'tradebook.noHoldingTitle': 'Rows with no matching holding',
  'tradebook.unreadableTitle': 'Rows that could not be read',
  'tradebook.rowNumber': 'Row {n}',
  'tradebook.unknownSymbol': '{symbol} matches no holding on record. Add the holding first, then import again.',
  'tradebook.ambiguous': '{symbol} matches more than one holding, so this cannot say which position it belongs to.',
  'tradebook.andMore': 'and {n} more.',
  'tradebook.refused.date': 'the date could not be read',
  'tradebook.refused.amount': 'the amount could not be read, and nothing in the row could work it out',
  'tradebook.refused.kind': 'this row does not say whether it is a buy or a sell',
  'tradebook.refused.symbol': 'this row names no instrument',
  'tradebook.field.date': 'Trade date',
  'tradebook.field.symbol': 'Instrument',
  'tradebook.field.kind': 'Buy or sell',
  'tradebook.field.amount': 'Total value',
  'tradebook.field.units': 'Units',
  'tradebook.field.pricePerUnit': 'Price per unit',
  'tradebook.field.charges': 'Brokerage & charges',
  'tradebook.field.reference': 'Trade or order id',
};
