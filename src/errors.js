"use strict";

// Error codes returned by the API as { error: { code, message, params } }.
// Clients translate by `code` (see shared/locales/*.json → "errors").
// `message` is only an English fallback, taken from shared/locales/en.json.
const english = require("../shared/locales/en.json").errors;

const ERROR_STATUS = Object.freeze({
  // Generic
  BAD_REQUEST: 400,
  INVALID_JSON: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  REQUEST_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  PRECONDITION_REQUIRED: 428,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  UPSTREAM_TIMEOUT: 504,

  // Storage and versioning
  STORE_REVISION_CONFLICT: 409,
  DATABASE_VERSION_UNSUPPORTED: 400,
  BASE_REVISION_REQUIRED: 428,
  REVISION_CONFLICT: 409,
  REVISION_NOT_FOUND: 404,
  REVISION_MISMATCH: 409,
  REVISIONS_REQUIRED: 400,
  WORK_UPDATED_ELSEWHERE: 409,

  // Works, chapters, scenes
  WORK_NOT_FOUND: 404,
  CHAPTER_NOT_FOUND: 404,
  WORK_OR_CHAPTER_NOT_FOUND: 404,
  CHAPTER_STALE: 409,
  CHAPTER_CHANGED_DURING_GENERATION: 409,
  CHAPTER_ORDER_INVALID: 400,
  TRASH_CHAPTER_NOT_FOUND: 404,
  SCENES_INVALID: 400,
  SCENE_RANGES_INVALID: 400,
  SCENE_NEEDS_RELOCATION: 409,
  VOLUME_NOT_FOUND: 400,
  RANGE_CONTAINS_IMAGE: 400,
  RANGE_INVALID: 400,
  HUNKS_INVALID: 400,
  RICH_CONTENT_INVALID: 400,
  RICH_CONTENT_TOO_LARGE: 413,
  EXPORT_FORMAT_UNSUPPORTED: 400,

  // Chats, proposals, story bible
  CHAT_NOT_FOUND: 404,
  MESSAGE_EMPTY: 400,
  PROPOSAL_NOT_FOUND: 404,
  PROPOSAL_ALREADY_HANDLED: 409,
  PROPOSAL_NOTHING_SELECTED: 400,
  PROPOSAL_NOT_APPLIED: 409,
  ARTIFACT_TYPE_UNSUPPORTED: 400,

  // Canon and continuity
  CANON_PROPOSAL_NOT_FOUND: 404,
  CANON_PROPOSAL_ALREADY_HANDLED: 409,
  CANON_PROPOSAL_INCOMPLETE: 400,
  CANON_PROPOSAL_REQUIRES_ACCEPTED_TEXT: 409,
  CANON_FACT_ID_CONFLICT: 409,
  CANON_FACT_NOT_ACTIVE: 409,
  FACT_FIELDS_REQUIRED: 400,
  CONFLICT_NOT_FOUND: 404,
  ADJUDICATION_REASON_REQUIRED: 400,
  REVIEW_BASIS_STALE: 409,

  // Generations and tasks
  GENERATION_NOT_FOUND: 404,
  GENERATION_STALE: 409,
  GENERATION_STALE_REVISION: 409,
  GENERATION_STALE_CONTENT: 409,
  GENERATION_HAS_HARD_CONFLICTS: 409,
  GENERATION_TEXT_MISSING: 400,
  GENERATION_STOPPED: 499,
  TASK_NOT_FOUND: 404,
  TASK_NOT_COMPLETED: 409,
  TASK_INTERRUPTED_BY_RESTART: 409,
  TASK_CANCELLED: 409,
  REQUEST_ID_REQUIRED: 400,
  REQUEST_ID_REUSED: 409,

  // Import
  IMPORT_PREVIEW_NOT_FOUND: 404,
  IMPORT_CHAPTERS_INVALID: 400,
  IMPORT_TEXT_TOO_LARGE: 413,
  IMPORT_FILE_TYPE_UNSUPPORTED: 400,
  IMPORT_FILE_INVALID: 400,
  IMPORT_FILE_EMPTY_OR_TOO_LARGE: 400,
  IMPORT_ENCODING_UNSUPPORTED: 400,
  IMPORT_ENCODING_MISMATCH: 400,
  IMPORT_ENCODING_UNKNOWN: 400,
  IMPORT_NOT_TEXT: 400,
  DOCX_INVALID: 400,
  DOCX_ARCHIVE_UNSUPPORTED: 400,
  DOCX_CORRUPTED: 400,
  DOCX_ENCRYPTED_OR_TOO_LARGE: 400,
  DOCX_NO_BODY: 400,
  DOCX_EXTERNAL_ENTITY: 400,

  // Images, covers, wallpapers
  IMAGE_INVALID: 400,
  IMAGE_EMPTY: 400,
  IMAGE_TYPE_UNSUPPORTED: 400,
  IMAGE_TOO_LARGE: 413,
  COVER_HISTORY_NOT_FOUND: 404,
  COVER_NOT_RELAYOUTABLE: 400,
  COVER_BACKGROUND_MISSING: 422,

  // Backup
  BACKUP_TOO_LARGE: 413,
  BACKUP_FORMAT_INVALID: 400,
  BACKUP_HISTORY_INVALID: 400,
  BACKUP_UNSUPPORTED: 400,
  BACKUP_MISSING_LIBRARY: 400,
  BACKUP_COVER_INVALID: 400,
  BACKUP_COVERS_TOO_LARGE: 413,
  BACKUP_IMAGES_TOO_LARGE: 413,
  BACKUP_LOCAL_IMAGE_MISSING: 422,

  // AI configuration and upstream
  URL_SCHEME_INVALID: 400,
  AI_UNAVAILABLE: 503,
  AI_PROVIDER_NOT_CONFIGURED: 400,
  AI_MODEL_NOT_ALLOWED: 400,
  AI_NO_WRITING_MODEL: 502,
  AI_IMAGE_NOT_CONFIGURED: 400,
  AI_TIMEOUT: 502,
  AI_NETWORK_TIMEOUT: 502,
  AI_NETWORK_DNS: 502,
  AI_NETWORK_RESET: 502,
  AI_NETWORK_UNREACHABLE: 502,
  AI_AUTH_FAILED: 401,
  AI_FORBIDDEN: 403,
  AI_RATE_LIMITED: 429,
  AI_DAILY_LIMIT_REACHED: 429,
  AI_IMAGE_ENDPOINT_UNSUPPORTED: 404,
  AI_ENDPOINT_MISMATCH: 404,
  AI_MODEL_UNAVAILABLE: 502,
  AI_UPSTREAM_ERROR: 502,
  AI_MODEL_LIST_FAILED: 502,
  AI_EMPTY_RESPONSE: 502,
  AI_REVIEW_INVALID: 502,
  AI_ARTIFACT_EMPTY: 422,
  AI_OUTPUT_TOO_GENERIC: 422,
  AI_IMAGE_EMPTY: 502,
  AI_IMAGE_DOWNLOAD_FAILED: 502,
  AI_IMAGE_TYPE_UNSUPPORTED: 502,
  AI_COVER_TOO_LARGE: 413
});

const STATUS_FALLBACK_CODE = Object.freeze({
  400: "BAD_REQUEST",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE",
  428: "PRECONDITION_REQUIRED",
  502: "UPSTREAM_ERROR",
  503: "SERVICE_UNAVAILABLE",
  504: "UPSTREAM_TIMEOUT"
});

function interpolate(template, params) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (
    params && params[key] !== undefined && params[key] !== null ? String(params[key]) : match
  ));
}

function englishMessage(code, params) {
  return interpolate(english[code] || english.INTERNAL_ERROR || code, params);
}

class AppError extends Error {
  constructor(code, params = {}, options = {}) {
    if (!Object.hasOwn(ERROR_STATUS, code)) throw new TypeError(`Unknown error code: ${code}`);
    super(englishMessage(code, params), options.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.params = params || {};
    this.status = options.status ?? ERROR_STATUS[code];
    this.statusCode = this.status;
  }
}

function appError(code, params, options) {
  return new AppError(code, params, options);
}

function isAppError(error) {
  return error instanceof AppError || Boolean(error && typeof error.code === "string" && Object.hasOwn(ERROR_STATUS, error.code) && error.status);
}

// Turns any thrown value into the public error body. Unknown errors never leak
// their internal message.
function toErrorResponse(error) {
  if (isAppError(error)) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: englishMessage(error.code, error.params), params: error.params || {} } }
    };
  }
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const code = STATUS_FALLBACK_CODE[status] || "INTERNAL_ERROR";
  return { status, body: { error: { code, message: englishMessage(code), params: {} } } };
}

module.exports = {
  AppError,
  ERROR_STATUS,
  appError,
  englishMessage,
  interpolate,
  isAppError,
  toErrorResponse
};
