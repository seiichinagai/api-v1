const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const crypto = require('crypto');
const js2xml = require('js2xmlparser');
const alert_slack = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack;
const alert_slack_activity = require('/var/www/html/api.shiftedenergy.com/scripts/slack_alert.js').alert_slack_activity;
const send_command = require('/var/www/html/api.shiftedenergy.com/apricity/send_command').send_command;

router.post('/', (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':'); 
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  if (login == "webDNA" && password == "de0xyr!bonucleic4c!d"){
    console.log(new Date().toISOString() + ' WebDNA calling AG FFR Config.')
    try {
      fs.readFile('/var/www/html/api.shiftedenergy.com/reference/ag_token_v2.db','utf8',function(token_err,data){
        if(token_err){
          console.log(token_err);
        }
        token = data;

        sendCommands(req.body, 0, res);
      })
    } catch (err) {
      console.log(err);
      if(!res.headerSent){
        res.status(500).send(err);
        next();
      }
    }
  } else {
    return next(createError(400, 'Unauthorized'));
  }
});

function sendCommands(body, index, res){
  var config = {
    "info": {
      "ffr": {
        "enable": body.enable,
        "tripThreshold": body.tripThreshold,
        "returnThreshold": body.returnThreshold,
        "periods": body.periods,
        "delay": body.delay
      }
    }
  }

  var command = '/var/www/html/api.shiftedenergy.com/scripts/ag_ffr_config_v2.sh ' + body.devices[index] + ' ' + token + " '" + JSON.stringify(config) + "'";

  console.log(body.devices[index] + '\n' + JSON.stringify(config))
  exec(command, function(err, stdout){
    if(err){console.log(err)}
    console.log(stdout);
    if (index == body.devices.length - 1){
      res.status(200).json({
        message: 'ffr config sent to ag'
      });
    } else {
      index = index + 1;
      sendCommands(body, index, res)
    }
  })
}

module.exports = router;