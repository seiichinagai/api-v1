const fs = require('fs');
const path = require('path');
const util = require('util');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

router.post("/", (req, res, next) => {
  // console.log(req.body)
  if(req.body.key && req.header('Authorization') && req.header('Authorization') == 'Bearer 15c480de852fded30b7915f204d6073598a07eae88a7eae0'){
    if(req.body.stage && req.body.stage == "prod"){
      try {
        fs.writeFile("/var/www/html/api.shiftedenergy.com/apricity/HMAC_Token.db", req.body.key, function(err){
          if(err){
            console.log(err);
          }
        })
      } catch (error){
        console.log(error);
        if(!res.headerSent){
          res.status(500).send(error);
          next();
        }
      }
      if(!res.headerSent){
        res.status(200).send("success");
        next();
      }
    } else if(req.body.stage && req.body.stage == "dev"){
      try {
        fs.writeFile("/var/www/html/api.shiftedenergy.com/apricity/HMAC_Token_Dev.db", req.body.key, function(err){
          if(err){
            console.log(err);
          }
        })
      } catch (error){
        console.log(error);
        if(!res.headerSent){
          res.status(500).send(error);
          next();
        }
      }
      if(!res.headerSent){
        res.status(200).send("success");
        next();
      }
    } else {
      if(!res.headerSent){
        res.status(400).send("invalid");
        next();
      }
    }
  } else {
    if(!res.headerSent){
      res.status(400).send("invalid");
      next();
    }
  }
  
});



module.exports = router;