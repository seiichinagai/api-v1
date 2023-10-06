const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const express = require('express');
const router = express.Router();
const time = require('time');
const createError = require('http-errors');
const crypto = require('crypto');

// handles actual POST
router.post('/', (req, res, next) => {
  if (req.header('Authorization') && req.header('Authorization') == 'Bearer ZWNvbmV0IUFQSTpoYXdhaWlTaGlmdGVk') {
    var body, users;
    // log(req.body)
    try {
      body = JSON.parse(decrypt(req.body.message));
      // log(body);
      fs.readFile('/var/www/html/api.shiftedenergy.com/pyeconet/src/users.db','utf-8', function(err,stdout){
        
        // log(stdout);

        if(err){
          log(err)
        }
        if(stdout != 'undefined'){
          var json;
          try {
            users = JSON.parse(decryptUsers(stdout, body.key));
          } catch(jsonErr){
            log(jsonErr)
          }

          if(users){
            log('calling pyeconet')
            var command = "python3 /var/www/html/api.shiftedenergy.com/pyeconet/src/schedule.py '" + JSON.stringify(users) + "' '" + JSON.stringify(body.schedule) + "'";
            exec(command, function (error, stdout) {
              if(error){
                log(error);
              }
              log('\n' + new Date().toISOString() + '\n')
              log('python:\n' + stdout);
            });
          }
        }

        if(!res.headerSent){
          res.send({
            message: 'success',
          });
          next();
        }
      })
    } catch(decryptErr){
      log(decryptErr)
      body = decryptErr
    }

    // log(JSON.stringify(body.schedule));
  }
});

function decryptUsers(encryption, key) {
  try{
    var decipher = crypto.createDecipheriv('bf-ecb',key, '');
    decipher.setAutoPadding(false);
    var decryption = (decipher.update(encryption, 'hex', 'utf8') + decipher.final('utf8')).replace(/\x00+$/g, '');

    return decryption
  } catch(e){
    log('decrypt: ' +e)
  }
 
}

function decrypt(encryption) {
  var decipher = crypto.createDecipheriv('bf-ecb','W8c$jnaIV', '');
  decipher.setAutoPadding(false);
  var decryption = (decipher.update(encryption, 'hex', 'utf8') + decipher.final('utf8')).replace(/\x00+$/g, '');

  return decryption
}

function log(text){
  var ws = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/pyeconet/log.db', {flags: 'a'});
  ws.write('\n' + text);
  ws.end();
}

module.exports = router;