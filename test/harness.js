// Offline harness: stubs the npm packages that are not installed in this sandbox
// (express, socket.io, pg, ...) so the REAL server modules can be exercised in-process.
const Module = require('module');
const crypto = require('crypto');
const EventEmitter = require('events');

const stubs = {
  dotenv: { config() {} },
  uuid: { v4: () => crypto.randomUUID() },
  'web-push': { generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }), setVapidDetails() {}, sendNotification: async () => {} },
  nodemailer: { createTransport: () => ({ sendMail: async () => {} }) },
  pg: { Pool: class {} },
  pdfkit: class {},
  multer: Object.assign(() => ({ single: () => (req, res, next) => next() }), { diskStorage: () => ({}), memoryStorage: () => ({}) }),
  'express-rate-limit': () => (req, res, next) => next && next(),
  express: (() => {
    const mk = () => { const r = { routes: [], get: (p, ...h) => (r.routes.push(['get', p, h]), r), post: (p, ...h) => (r.routes.push(['post', p, h]), r), use() { return r; } }; return r; };
    const e = () => mk(); e.Router = mk; e.json = () => (q, s, n) => n && n(); e.urlencoded = () => (q, s, n) => n && n(); e.static = () => (q, s, n) => n && n();
    return e;
  })(),
  'socket.io': { Server: class {} }
};
const orig = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return orig.apply(this, arguments);
};

// ---- Fake Socket.IO -------------------------------------------------------
class FakeSocket extends EventEmitter {
  constructor(io, id, ip) {
    super(); this.io = io; this.id = id; this.rooms = new Set(); this.emitted = [];
    this.handshake = { headers: { 'x-forwarded-for': ip || '10.0.0.1' }, address: ip || '10.0.0.1' };
    this.handlers = {};
  }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  emit(ev, data) { this.emitted.push([ev, data]); this.io._deliver(this, ev, data); return true; }
  join(r) { this.rooms.add(r); } leave(r) { this.rooms.delete(r); }
  to(room) { return { emit: (ev, data) => this.io._toRoom(room, ev, data, this) }; }
  disconnect() { this.disconnected = true; }
  async fire(ev, data) { if (!this.handlers[ev]) throw new Error('no handler ' + ev); return this.handlers[ev](data); }
  last(ev) { for (let i = this.emitted.length - 1; i >= 0; i--) if (this.emitted[i][0] === ev) return this.emitted[i][1]; return undefined; }
  all(ev) { return this.emitted.filter((x) => x[0] === ev).map((x) => x[1]); }
}
class FakeIO {
  constructor() { this.sockets = { sockets: new Map() }; this.log = []; }
  add(ip) { const s = new FakeSocket(this, 's' + (this.sockets.sockets.size + 1), ip); this.sockets.sockets.set(s.id, s); return s; }
  _deliver() {}
  _toRoom(room, ev, data, except) { this.log.push([room, ev, data]); for (const s of this.sockets.sockets.values()) if (s !== except && s.rooms.has(room)) s.emitted.push([ev, data]); }
  to(room) { return { emit: (ev, data) => this._toRoom(room, ev, data, null) }; }
  of() { return this; }
}
module.exports = { FakeIO, FakeSocket };
