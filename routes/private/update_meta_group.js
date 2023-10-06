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
function encrypt(email, password) {
  var XMLString = '<root><method>validate_user</method><email>' + email + 
      '</email><password>' + password + '</password></root>';
  var cipher = crypto.createCipheriv('bf-ecb', '2W^a9@kj', '');
  cipher.setAutoPadding(false);
  var encryption = cipher.update(pad(XMLString), 'utf8', 'hex') + cipher.final('hex');

  return encryption;
}

// Decrypt data, mostly used for testing
function decrypt(encryption) {
  var decipher = crypto.createDecipheriv('bf-ecb','2W^a9@kj', '');
  decipher.setAutoPadding(false);
  var decryption = (decipher.update(encryption, 'hex', 'utf8') + decipher.final('utf8')).replace(/\x00+$/g, '');

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

  if (login == "webDNA" && password == "de0xyr!bonucleic4c!d"){
    console.log(req.body);
    var json;
    try {
      json = JSON.parse(decrypt(req.body.message));
    } catch (err) {
      if(!res.headersSent){
        res.status(401).json({
          message: decrypt('333f1780b1ab57aa44a5dd5b69b93b4db3e0e79481c0c91a068938d6c63f0ac256ce20391e6bcad88f12141ae21350fb49509708f05b8c8ceedd031b3e94b9b0311f522d9a0daf0e745f14ccc80cfaa1c855a2816be0b8428d48b3b62c09c6a8e7d092e25a3641119fb08b7fbe21165a2a3102dd8a1d8525f7649ed5451857db9fb08b7fbe21165ad135e6b4cf74ae6272490e053a161b09a920217cc29d51038d48b3b62c09c6a89fb08b7fbe21165a3b8de0b98fb79f057f3414d79fcf9b1e9fb08b7fbe21165aba57e8850733da9a9fb08b7fbe21165a888b6267cee36c944b4303854aad0360d656ce6ff72da1899fb08b7fbe21165a4f05d36f6a2d75295933a62482d5d6e83b967c6c5de5148c618ca06f303233ba')
        });
        next();
      }
    }
    var meta_group_file = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/reference/meta_groups/' + json['meta_group'] + '.db', {flags: 'w'});
    meta_group_file.write(JSON.stringify(json, null, 4));
    meta_group_file.end();
    if(!res.headersSent){
      res.status(201).json({
        message: 'Meta group updated'
      });
      next();
    }
  } else if(!res.headersSent){
    res.status(401).json({
      message: 'Not Authorized'
    });
    next();
  }
  
});


module.exports = router;