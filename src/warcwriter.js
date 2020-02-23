"use strict";

import { WARCWriterBase } from 'node-warc';

import { Writable } from 'stream';
import { RequestResponseInfo } from './requestresponseinfo.js';


// ===========================================================================
class WARCWriter extends WARCWriterBase {
  constructor() {
    super();
    this._warcOutStream = new BufferWritableStream();
    //this._warcOutStream = new VirtFSWritableStream();
    this.opts = {"gzip": true, "appending": false}
  }

  async writeFromDBIter(iter) {
    const reqresp = new RequestResponseInfo();

    for await (const cursor of iter) {
      const record = cursor.value;

      if (record.mime === "fuzzy" || (!record.url.startsWith("http:") && !record.url.startsWith("https:"))) {
        console.log("Skipping: " + record.url);
        continue;
      }

      reqresp.fillFromDBRecord(record);
      this._now = new Date(record.ts).toISOString();

      this.writeResponseRecord(record.url, reqresp.getResponseHeadersText(), record.payload);
    }

    return this.toBlob();
  }

  toBlob() {
    return new Blob([this._warcOutStream.toBuffer()], {"type": "application/octet-stream"});
  }

  processRequestResponse(reqresp, payload) {
    const url = reqresp.url;
    const responseHeaders = reqresp.getResponseHeadersText()

    if (!payload) {
      payload = Buffer.from([]);
    }

    if (reqresp.hasRequest()) {
      this.writeRequestResponseRecords(
        url, 
        {
          headers: reqresp.getRequestHeadersText(),
          data: reqresp.postData
        },

        {
          headers: responseHeaders,
          data: payload
        }
      );
    } else {
      this.writeResponseRecord(
        url,
        responseHeaders,
        payload
      ); 
    }
  }
}

// ===========================================================================
// Writable to browser virtual filesystem via webkitRequestFileSystem()
class VirtFSWritableStream extends Writable {
  constructor() {
    super();
    this.chunks = [];

    this.writer = window.virtualWriter;

    this.writer.addEventListener("writeend", () => {
      this._writeNext();
    });

    this.writer.addEventListener("error", (err) => {
      console.warn("Wrtier Err: " + err);
    });
  }

  getLength() {
    return this.writer.length;
  }

  write(chunk, encoding, callback) {
    this.chunks.push(chunk);
    this._writeNext();
    return true;
  }

  _writeNext() {
    if (this.writer.readyState === this.writer.WRITING) {
      return;
    }

    if (!this.chunks.length) {
      this.emit('drain');
      return;
    }

    const chunk = this.chunks.shift();

    const res = this.writer.write(new Blob([chunk], {type: "application/octet-stream"}));

    this.emit('drain');
  }

  end(chunk, encoding, callback) {
    this.write(chunk, encoding, callback);
    this.emit('finish');
    return this;
  }
}

// ===========================================================================
// Writable to in memory buffer
class BufferWritableStream extends Writable {
  constructor() {
    super();
    this.length = 0;
  }

  write(chunk, encoding, callback) {
    const res = super.write(chunk, encoding, callback);

    this.length += chunk.length;

    if (!res) {
      this.emit('drain');
    }

    return res;
  }

  _write(chunk, encoding, callback) {
    return this.write(chunk, encoding, callback);
  }

  end(chunk, encoding, callback) {
    const res = super.end(chunk, encoding, callback);
    this.emit('finish');
    return res;
  }

  toBuffer() {
    let buffers = [];

    for (let buffer of this._writableState.buffer) {
      buffers.push(buffer.chunk);
    }
  
    return Buffer.concat(buffers);
  }
}



export { WARCWriter };
