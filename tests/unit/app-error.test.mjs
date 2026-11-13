import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AppError,
  errorMessage,
  isRevisionConflict,
  parseAppError,
} from '../../src/lib/app-error.ts';

test('native error objects keep their code and message', () => {
  const error = parseAppError({ code: 'revision_conflict', message: '文档已被其他操作修改' });
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'revision_conflict');
  assert.equal(error.message, '文档已被其他操作修改');
  assert.equal(isRevisionConflict({ code: 'revision_conflict', message: '' }), true);
});

test('strings, Errors and unknown codes become unknown errors with the original text', () => {
  assert.deepEqual(
    [
      parseAppError('出错了'),
      parseAppError(new Error('boom')),
      parseAppError({ code: 'x', message: 'm' }),
    ].map((error) => [error.code, error.message]),
    [
      ['unknown', '出错了'],
      ['unknown', 'boom'],
      ['unknown', 'm'],
    ],
  );
  assert.equal(isRevisionConflict(new Error('文档已被其他操作修改')), false);
});

test('English messages come from the error code and fall back to the original text', () => {
  assert.equal(errorMessage({ code: 'locked', message: '已锁定' }, 'zh'), '已锁定');
  assert.equal(
    errorMessage({ code: 'locked', message: '已锁定' }, 'en'),
    'This item is locked and cannot be changed.',
  );
  assert.equal(errorMessage('原始错误', 'en'), '原始错误');
});
