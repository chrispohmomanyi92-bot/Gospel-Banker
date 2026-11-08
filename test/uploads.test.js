import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.MEDIA_DIR = (await import('node:os')).tmpdir() + '/gb-test-media';
const { classifyUpload } = await import('../server/videos.js');

test('uploads are sorted into video, audio and file', () => {
  assert.deepEqual(classifyUpload('video/mp4', 'sermon.mp4'), { kind: 'video', ext: '.mp4' });
  assert.deepEqual(classifyUpload('audio/mpeg', 'wimbo.mp3'), { kind: 'audio', ext: '.mp3' });
  assert.deepEqual(classifyUpload('application/pdf', 'lesson.pdf'), { kind: 'file', ext: '.pdf' });
});
test('a missing or generic type falls back to the file extension', () => {
  assert.equal(classifyUpload('application/octet-stream', 'Choir.M4A').kind, 'audio');
  assert.equal(classifyUpload('', 'study.docx').kind, 'file');
});
test('programs and web pages are refused', () => {
  for (const [type, name] of [['application/x-msdownload', 'setup.exe'], ['text/html', 'page.html'], ['image/svg+xml', 'logo.svg'], ['application/octet-stream', 'run.sh']]) {
    assert.equal(classifyUpload(type, name), null, name);
  }
});
