const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');

// POST
router.get('/', (req, res, next) => {
  if(req.param && (req.param('state') || req.param('code') || req.param('error'))) {
    var stream = fs.createWriteStream("/var/www/html/api.shiftedenergy.com/logs/redirect.log", {flags:'a'});
    stream.write('\n' + new Date().toISOString() + '\n')
    if(req.param('error'))
      stream.write('Error: ' + req.param('error') + '\n')
    if(req.param('state'))
      stream.write('Client: ' + req.param('state') + '\n')
    if(req.param('code'))
      stream.write('Code: ' + req.param('code') + '\n')
    stream.end();
  } else {
    var stream = fs.createWriteStream("/var/www/html/api.shiftedenergy.com/logs/redirect.log", {flags:'a'});
    stream.write('\n' + new Date().toISOString() + '\n')
    stream.write(req.body)
    stream.end();
  }
  res.status(200).json({
    message: '200'
  });
});

module.exports = router;