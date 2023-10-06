const fs = require('fs');
const path = require('path');
const util = require('util');
const express = require('express');
const router = express.Router();
var today = new Date();

router.post("/", (req, res, next) => {
  console.log(req.body);
  try {
    if (req.header('Authorization') && req.header('Authorization') == 'Bearer YXdzX2RhdGFfZXhwb3J0OmEzS2w1OWFqV2tjbSE=') {
      try{
        if (req.body.groups){
          try {
            fs.readFile('/var/www/html/api.shiftedenergy.com/data_export/groups.json', 'utf-8', function(err,data){
              try {
                var export_groups = JSON.parse(data);
                var a;
                if(export_groups[req.body.client]){
                  a = export_groups[req.body.client].groups;
                } else {
                  var e = JSON.parse(JSON.stringify(req.body));
                  delete e['client']
                  export_groups[req.body.client] = e;
                  // delete export_groups[req.body.client]['client']
                  a = export_groups[req.body.client].groups
                }
                var b = req.body.groups;
                var c = a.concat(b);
                var d = c.filter((item, pos) => c.indexOf(item) === pos)

                var json = export_groups;
                // console.log(json)
                json[req.body.client].groups = d;
                // res.status(201).json({
                //   message: json
                // });


                var ws = fs.createWriteStream('/var/www/html/api.shiftedenergy.com/data_export/groups.json', {flags: 'w'});
                ws.write(JSON.stringify(json, null, 4));
                ws.end();
                res.status(201).json({
                  message: 'ok'
                });
              } catch (e){
                console.log(e)
                res.status(500).json({
                  message: 'Internal server error'
                });
              }
            })
          } catch (e){
            console.log(e);
            res.status(500).json({
              message: 'Internal server error'
            });
          }
        } else {
          res.status(401).json({
            message: 'groups missing'
          });
        }
      } catch (e){
        console.log(e);
        res.status(401).json({
          message: 'err'
        });
      }
    } else {
      res.status(401).json({
        message: 'Unauthorized'
      });
    }
  } catch (error) {
    console.log(error);
    res.status(400).json({
      message: 'Invalid body'
    })
  }
  
});





module.exports = router;