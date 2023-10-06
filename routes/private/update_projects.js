const fs = require('fs');
const path = require('path');
const util = require('util');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');


// Deals with padding to 8 bytes
function pad(text) {
   pad_bytes = 8 - (text.length % 8)
   for (var x=1; x<=pad_bytes;x++)
     text = text + String.fromCharCode(0)
   return text;
}

// Converts data received from user to XML format
// Encrypts and returns entire XML string
// Encryption may add on a few chars for padding but ignore anything after </root>
function encrypt(JSONString) {
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(JSONString), 'utf8', 'hex') + cipher.final('hex');

  return encryption;
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
  receive list of projects - encrypted 
  decrypt contents
  update file locally
  send response
*/
router.post("/", (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const strauth = new Buffer(b64auth, 'base64').toString();
  const splitIndex = strauth.indexOf(':');
  const login = strauth.substring(0, splitIndex);
  const password = strauth.substring(splitIndex + 1);

  try {
    if (login == "webDNA" && password == "de0xyr!bonucleic4c!d"){
      try {
        var heaters_file = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/projects.db', {flags: 'w'});
        var heaters_json = JSON.parse(decrypt(req.body.message));
        heaters_file.write(JSON.stringify(heaters_json, null, 4));
        heaters_file.end();
        res.status(201).json({
          message: 'Projects updated'
        });
      } catch (err){
        res.status(401).json({
          message: 'Message Invalid'
        });
      }
      
    } else {
      res.status(401).json({
        message: 'Unauthorized'
      });
    }
  } catch (error) {
    res.status(400).json({
      message: 'Message Invalid'
    })
  }
  
});





module.exports = router;