// app.js

var express = require('express'),
  app = express(),
  server = require('http').Server(app),
  cloudant = require('./lib/db.js'),
  async = require('async'),
  moment = require('moment'),
  hp = cloudant.db.use("houseprices");

  
//setup static public directory
app.use(express.static(__dirname + '/public')); 

// use the jade templating engine
app.set('view engine', 'jade');


// sorting function to sort list of transactions by date
var datesort = function(a,b) {
  if(a.doc.date < b.doc.date) return -1;
  if(a.doc.date > b.doc.date) return 1;
  return 0;
};
  
// render home page
app.get("/", function(req,res) {
  res.render("index");
});  
  
// render postcode page
app.get('/postcode/:pc', function(req, res){
  var original_postcode = req.params.pc;
  var postcode = original_postcode.toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!postcode.match(/^[A-Z]+[0-9]+[A-Z]?[0-9][A-Z][A-Z]$/)) {
    return res.redirect("/");
  }
  if(postcode != original_postcode) {
    return res.redirect("/postcode/"+postcode);
  }
  var pcd = postcode.substr(0, postcode.length-3);
  
  // fetch the three views in parallel
  async.parallel([
    
    // first a list of all transactions for that postcode
    function(callback) {
      var options = {
        key: postcode,
        reduce: false,
        include_docs:true
      };
      hp.view('fetch','bypostcode', options, function(err, data) {
        data.rows.sort(datesort);
        callback(null,data.rows);
      });
    },
    
    // next the national trend
    function(callback) {
      var options = {
        group_level:1
      };
      hp.view('fetch','bytime', options, function(err, data) {
        callback(null,data.rows);
      });
    },
    
    // then the trend for this postcode district
    function(callback) {
      var options = {
        startkey:[pcd],
        endkey:[pcd+"z"],
        group_level:2
      };
      hp.view('fetch','bypcdandtime', options, function(err, data) {
        callback(null,data.rows);
      });
    }
    
    
  ], function(err, data) {
    
    var trend = [ ["Year", "Price"] ];
    var yearmap = { };
    for(var i in data[1]) {
      var v = [ data[1][i].key[0].toString() , data[1][i].value.sum / data[1][i].value.count]
      trend.push(v);
      yearmap[ v[0]] =v[1];
    }
    
    var trend2 = [ ["Year", "Max","Avg", "Min", "Nat. Avg"] ];
    for(var i in data[2]) {
      var year = data[2][i].key[1].toString();
      var v = [ year , // label
                data[2][i].value.max, // max
                data[2][i].value.sum / data[2][i].value.count, // average
                data[2][i].value.min,
                yearmap[ year ]]; // min 

      trend2.push(v);
    }
    
    res.render('postcode',{ postcode: postcode, pcd:pcd, bypostcode: data[0], byyear: trend, bypcd: trend2})

  });
});



// The IP address of the Cloud Foundry DEA (Droplet Execution Agent) that hosts this application:
var host = (process.env.VCAP_APP_HOST || 'localhost');
// The port on the DEA for communication with the application:
var port = (process.env.VCAP_APP_PORT || 3000);
// Start server
server.listen(port, host);
console.log('App started on port ' + port);


