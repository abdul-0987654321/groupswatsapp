'use strict';
/**
 * Fingerprints for duplicate detection:
 *  - sha256 of the exact file bytes (same file sent twice)
 *  - a tiny 32x64 grayscale thumbnail; the mean pixel difference between two thumbnails
 *    stays small when the same screenshot is re-compressed or resized by WhatsApp.
 *    Measured on real receipts: same image re-encoded ≤ 3.1, different receipts ≥ 12.
 *    We use a strict threshold (plus "same amount" in verify.js) to avoid false alarms
 *    between different receipts from the same banking app.
 */

const crypto = require('crypto');
const sharp = require('sharp');

const NEAR_DUPLICATE_MAX_DIFF = 2.0;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function thumbnail(buffer) {
  const { data } = await sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(32, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Buffer.from(data).toString('base64');
}

/** Mean absolute pixel difference (0–255) between two thumbnails. */
function thumbnailDiff(a, b) {
  if (!a || !b) return Infinity;
  const x = Buffer.from(a, 'base64');
  const y = Buffer.from(b, 'base64');
  if (x.length !== y.length || !x.length) return Infinity;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length;
}

function isNearDuplicate(a, b) {
  return thumbnailDiff(a, b) <= NEAR_DUPLICATE_MAX_DIFF;
}

async function fingerprints(buffer, mimeType) {
  const out = { imageHash: sha256(buffer), thumbnail: null };
  if (String(mimeType).startsWith('image/')) {
    try {
      out.thumbnail = await thumbnail(buffer);
    } catch {
      /* not decodable: exact hash only */
    }
  }
  return out;
}

module.exports = { sha256, thumbnail, thumbnailDiff, isNearDuplicate, fingerprints, NEAR_DUPLICATE_MAX_DIFF };
