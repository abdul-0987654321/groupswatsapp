'use strict';
/** Shared OpenAI client (null when OPENAI_API_KEY is missing). Tests can swap it via setClient(). */

const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let client;

function getClient() {
  if (client !== undefined) return client;
  client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 2 }) : null;
  return client;
}

function setClient(c) {
  client = c;
}

module.exports = { MODEL, getClient, setClient };
