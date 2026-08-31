/**
 * English, for Settings → Data.
 *
 * A separate file for the same reason as `en-signin.js` and `en-periods.js`:
 * `en.js` is the catalogue, this is a block that changes with one idea, and
 * the module-size ratchet holds `en.js` under 800 lines.
 *
 * These sentences were written directly into `js/modules/settings/data.js`,
 * where no catalogue could reach them. Four of them were concatenated across
 * three and seven source lines; they are one key each here, because a
 * translator needs the sentence rather than the halves English happened to
 * break it into, and because the placeholder check can only guard a whole one.
 */

export const settingsDataStrings = {
  'settings.data.title': 'Data on this device',
  'settings.data.storageUsed': 'Storage used',
  'settings.data.megabytes': '{n} MB',
  'settings.data.quota': 'Browser storage quota',
  'settings.data.reindex': 'Rebuild the search index',
  'settings.data.reindexed': 'Reindexed {n} record types',
  'settings.data.checkLinks': 'Check for broken links',
  'settings.data.brokenCount': '{n} broken references',
  'settings.data.noBroken': 'No broken references',
  'settings.data.brokenRow': '{entity} · {label}',
  'settings.data.brokenPoints': 'points at {id}, which is deleted or missing',
  'settings.data.allRefsOk': 'Every reference points at a record that exists.',

  'settings.data.eraseButton': 'Erase everything on this device',
  'settings.data.eraseTitle': 'Erase FamilyOS from this device?',
  'settings.data.eraseMessage': 'Every record, the encryption key and the queue are deleted from this browser. Anything already synced stays in your Google Sheets and Drive; anything not yet synced is gone for good. This cannot be undone.',
  'settings.data.eraseConfirm': 'Erase everything',
  // `{word}` is the literal the code compares against, passed in rather than
  // written into the sentence: a translation that localised the word itself
  // would tell somebody to type something the comparison then rejects.
  'settings.data.eraseTypeTitle': 'Type {word} to confirm',
  'settings.data.eraseTypeLabel': 'This is deliberately awkward',
  'settings.data.notErased': 'Not erased.',

  'settings.data.deletedTitle': 'Deleted items',
  'settings.data.deletedBlurb': 'Nothing is ever hard-deleted — a deletion is a marker that replicates, so a device that has been offline learns about it rather than bringing the record back.',
  'settings.data.showDeleted': 'Show deleted records',
  'settings.data.deletedCount.one': '1 deleted record',
  'settings.data.deletedCount.many': '{n} deleted records',
  'settings.data.deletedRow': '{entity} · deleted {day}',
  'settings.data.nothingDeleted': 'Nothing deleted',

  'settings.data.conflictsBlurb': 'When two devices change the same field, FamilyOS merges them and records what it had to choose. Nothing here needs action — it is a record of decisions you can reverse.',
  'settings.data.showConflicts': 'Show conflicts',
  'settings.data.conflictCount': '{n} resolved conflicts',
  'settings.data.noConflicts': 'No conflicts',
  'settings.data.conflictValues': 'this device: {local} · other device: {remote}',
  'settings.data.conflictKept': 'kept: {value}',
  'settings.data.useThisDevice': 'Use this device’s version',
  'settings.data.reverted': 'Reverted to this device’s values',
  'settings.data.nothingConflicted': 'Nothing has conflicted',

  'settings.data.backupOwnerOnly': 'Only an owner can back up the household. Taken by anyone else it would be missing {missing} of the {total} kinds of record, and would not say so — which is worse than having no backup, because you would have stopped worrying about it.',
  'settings.data.backupBlurb': 'One encrypted file holding every record, every document and the keys that open them. It is the only backup this device has if you are not syncing to Google — see docs/PORTABILITY.md for what the CSV exports are and are not.',
  'settings.data.takeBackup': 'Take a backup',
  'settings.data.restoreFromFile': 'Restore from a file',
  'settings.data.phraseLabel': 'Your recovery phrase — it is what encrypts the file, and what opens it again',
  'settings.data.phrasePlaceholder': 'the words you wrote down when you set this up',
  'settings.data.takeBackupConfirm': 'Take the backup',
  'settings.data.wrongPhrase': 'That is not the recovery phrase for this household. Nothing was written.',
  'settings.data.backupTaken': '{records} records and {documents} documents, encrypted and read back. Keep it somewhere you control.',
  'settings.data.lastBackup': 'Last backup: {day}',
  'settings.data.neverBackedUp': 'No backup has ever been taken on this device.',

  'settings.data.restoreTitle': 'Restore a backup',
  'settings.data.restorePhraseLabel': 'The recovery phrase this file was taken with',
  'settings.data.openFile': 'Open the file',
  'settings.data.unknownDate': 'an unknown date',
  'settings.data.restoreConfirmTitle': 'Restore this backup?',
  'settings.data.restoreMessage': 'Taken on {taken}. It holds {records} records and {documents} documents.\n\nEverything in it will be written to this device, and the keys inside it become this device’s keys — so afterwards you unlock with the PIN and phrase that were in use when the backup was taken, not the ones on this device now.\n\nFamilyOS will reload when it finishes.',
  'settings.data.restoreRefused': 'The restore was refused.',
  'settings.data.restored': 'Restored {n} records. Reloading…',
};
