// Independent Node receiver: never log authorization, URLs, payload or headers.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const sha256 = body => createHash('sha256').update(body).digest();
const server = createServer((request, response) => {
  const parts = [];
  request.on('data', part => parts.push(part));
  request.on('end', () => {
    const body = Buffer.concat(parts);
    const hash = sha256(body);
    const valid = !request.headers['content-encoding'] && !request.headers['transfer-encoding']
      && !request.headers['x-amz-trailer'] && Number(request.headers['content-length']) === body.length
      && request.headers['x-amz-checksum-sha256'] === hash.toString('base64')
      && request.headers['x-amz-meta-sha256'] === hash.toString('hex')
      && request.headers['if-none-match'] === '*'
      && request.headers['x-amz-server-side-encryption'] === 'AES256';
    process.stdout.write(JSON.stringify({ valid, bytes: body.length, sha256: hash.toString('hex') }) + '\n');
    if (valid) {
      response.writeHead(200, { 'x-amz-version-id': 'fixture-version', 'content-length': '0' });
      response.end();
    } else {
      response.writeHead(400, { 'content-type': 'application/xml' });
      response.end('<Error><Code>InvalidRequest</Code><Message>synthetic wire contract rejected</Message></Error>');
    }
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port, runtime: 'node' }) + '\n'));
process.stdin.resume();
process.stdin.on('end', () => server.close());
