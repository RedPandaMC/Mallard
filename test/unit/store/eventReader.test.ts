import { strict as assert } from 'assert';
import { EventReader } from '../../../src/extension-backend/store/EventReader';

describe('EventReader.exportTo', () => {
  it('rejects an unsupported format before touching the database', async () => {
    const reader = new EventReader({} as never);
    await assert.rejects(
      reader.exportTo('/tmp/whatever.out', 'xml' as never),
      /Invalid export format/,
    );
  });
});
