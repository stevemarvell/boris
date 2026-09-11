import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/domain/types.js';
import { deriveTitle, normaliseTag, normaliseUrl, validateNewLink } from '../src/domain/validate.js';

describe('normaliseUrl', () => {
  it('keeps a well-formed url', () => {
    assert.equal(normaliseUrl('https://example.com/a'), 'https://example.com/a');
  });

  it('trims whitespace and strips the fragment', () => {
    assert.equal(normaliseUrl('  https://example.com/a#top '), 'https://example.com/a');
  });

  it('rejects a non-url', () => {
    assert.throws(() => normaliseUrl('not a url'), ValidationError);
  });

  it('rejects a non-http protocol', () => {
    assert.throws(() => normaliseUrl('ftp://example.com'), ValidationError);
  });
});

describe('normaliseTag', () => {
  it('lowercases and kebabs', () => {
    assert.equal(normaliseTag('  Deep Work '), 'deep-work');
  });

  it('rejects an empty tag', () => {
    assert.throws(() => normaliseTag('   '), ValidationError);
  });

  it('rejects punctuation', () => {
    assert.throws(() => normaliseTag('tag!'), ValidationError);
  });
});

describe('deriveTitle', () => {
  it('uses host and first segment', () => {
    assert.equal(deriveTitle('https://example.com/docs/guide'), 'example.com/docs');
  });

  it('falls back to the bare host', () => {
    assert.equal(deriveTitle('https://example.com/'), 'example.com');
  });
});

describe('validateNewLink', () => {
  it('dedupes and sorts tags', () => {
    const link = validateNewLink({ url: 'https://example.com', tags: ['b', 'a', 'A'] });
    assert.deepEqual(link.tags, ['a', 'b']);
  });

  it('derives a title when none is given', () => {
    assert.equal(validateNewLink({ url: 'https://example.com' }).title, 'example.com');
  });

  it('rejects an over-long title', () => {
    assert.throws(
      () => validateNewLink({ url: 'https://example.com', title: 'x'.repeat(201) }),
      ValidationError,
    );
  });

  it('requires a url', () => {
    assert.throws(() => validateNewLink({} as never), ValidationError);
  });
});
