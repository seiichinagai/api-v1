const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const time = require('time');
const j2xml = require('js2xmlparser');
const createError = require('http-errors');



// handles actual POST
router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':');
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  if (!req.headers['content-length']){return next(createError(411, 'Content length required'));}
  if (req.headers['content-type'] != "application/json") {return next(createError(400, 'Invalid Content-Type header'));}
  if (login == "oati_api" && password == "LO$fk59#u@7M"){
    res.status(200).json({
      "returnResult": true,
      "TimeStamp": new Date().toISOString()
    });
  } else {
    return next(createError(401, "Unauthorized"));
  }
});

module.exports = router;


/*
success
{
  "returnResult": true,
  "eventTime": "current UTC time",
  "objectID": "***Event identifier ***"
}
failure
{
  "returnResult": false,
  "returnReason": "***Error from Target System ***",
  "eventTime": "current UTC time" 
}
*/