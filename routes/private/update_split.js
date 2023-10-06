const fs = require('fs');
const path = require('path');
const util = require('util');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
var today = new Date();

// Deals with padding to 8 bytes
function pad(text) {
   pad_bytes = 8 - (text.length % 8)
   for (var x=1; x<=pad_bytes;x++)
     text = text + String.fromCharCode(0)
   return text;
}

// Decrypt data, mostly used for testing
function decrypt(encryption) {
  var decipher = crypto.createDecipheriv('bf-ecb','2W^a9@kj', '');
  decipher.setAutoPadding(false);
  var decryption = (decipher.update(encryption, 'hex', 'utf8') + decipher.final('utf8')).replace(/\x00+$/g, '');

  // console.log("decryption:\n" + decryption + "\n");
  return decryption;
}

/*
  receive split - encrypted 
  decrypt contents
  update file locally
  send response
*/
router.post("/", (req, res, next) => {
  try {
    if (req.body.token == 'A4#9gj_23mH' && fs.existsSync('/var/www/html/api.shiftedenergy.com/splits/' +
          today.toISOString().substring(0,10) + '.json')) { // if split.json already exists don't overwrite
      res.status(201).json({
        message: "file already exists"
      });
    } else if (req.body.token == 'A4#9gj_23mH') {
      var split_json = JSON.parse(decrypt(req.body.message));
      var last = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/splits/default.json', {flags: 'w'});
      last.write(JSON.stringify(split_json, null, 4));
      last.end();
      var split_file = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/splits/' + 
          today.toISOString().substring(0,10) + '.json', {flags: 'w'}); // change to splits/<date>_<group>.json
      split_file.write(JSON.stringify(split_json, null, 4));
      split_file.end();
      res.status(201).json({
        message: 'split received'
      });
    } else {
      res.status(401).json({
        message: 'Unauthorized'
      });
      var request_ips = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/request_ips.txt', {flags: 'a'});
      request_ips.write('split ' + req.connection.remoteAddress + '\n');
    }
  } catch (error) {
    console.log(error);
    res.status(400).json({
      message: 'Invalid body'
    })
  }
  
});





module.exports = router;