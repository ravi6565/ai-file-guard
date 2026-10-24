import assert from 'node:assert/strict';
import { connectHost, isPublicIPv4 } from '../enforcement/networkProxy';

describe('Managed HTTPS proxy destination policy', () => {
  it('accepts public HTTPS hostname authorities only', () => {
    assert.equal(connectHost('registry.npmjs.org:443'), 'registry.npmjs.org');
    assert.equal(connectHost('API.OpenAI.com:443'), 'api.openai.com');
    for (const authority of ['localhost:443', 'machine.local:443', 'machine.internal:443', '127.0.0.1:443', '[::1]:443',
      '[::ffff:127.0.0.1]:443', 'api.openai.com:80', 'api.openai.com:443/path', 'user@api.openai.com:443', 'host:443',
      'api..openai.com:443', '-api.openai.com:443', 'api.openai.com.:443']) {
      assert.throws(() => connectHost(authority), /denied|supported/i, authority);
    }
  });

  it('rejects private, loopback, reserved, metadata and mapped addresses after DNS', () => {
    for (const address of ['0.0.0.0', '10.0.0.1', '100.64.1.1', '127.0.0.1', '127.0.0.2', '169.254.169.254',
      '172.16.1.1', '172.31.255.255', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
      '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', 'invalid']) {
      assert.equal(isPublicIPv4(address), false, address);
    }
    for (const address of ['1.1.1.1', '8.8.8.8', '104.16.9.34']) assert.equal(isPublicIPv4(address), true, address);
  });
});
