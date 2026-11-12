"use strict";
const { appError } = require("./errors");

// Single entry point for "who is making this request".
//
// Development placeholder: every request is the one local user. There are no
// accounts yet (planned for the launch-preparation phase). Every API handler
// receives the resolved user from here, and every new piece of data records
// its owner through `user.id`, so real sign-in can replace this function later
// without touching the handlers.
const LOCAL_USER = Object.freeze({
  id: "local",
  kind: "local-dev",
  displayName: ""
});

function authenticate(_req) {
  return LOCAL_USER;
}

// Throws unless `record` belongs to `user`. Records written before ownership
// existed carry no ownerId and are treated as the local user's.
function assertOwner(user, record) {
  if (!user) throw appError("AUTH_REQUIRED");
  const ownerId = record?.ownerId || LOCAL_USER.id;
  if (ownerId !== user.id) throw appError("NOT_FOUND");
}

module.exports = {
  LOCAL_USER,
  assertOwner,
  authenticate
};
