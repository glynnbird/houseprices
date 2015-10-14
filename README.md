# House Price Analysis using Cloudant and dashDB


## Introduction 
As I've recently moved house, I've paid more attention than usual to local house prices. How much are the houses on my street selling for? How does that compare to the national average? There are websites out there which will report such information, but what's the fun in using someone else's service when you can build your own?

The UK government releases a plethora of public data on its website http://data.gov.uk/. The data is in a variety of formats (XML, CSV, XLS etc) and is freely available to download for analysis or re-publication. The data covers a variety of topics from road maintenance and government spending to social trends and baby naming. For the purposes of this demonstration, I chose the [Land Registry Price Paid Data](https://data.gov.uk/dataset/land-registry-monthly-price-paid-data) which records the price paid for every house sale in the UK since 1995.

This project's aim is to import this data set into Cloudant and use MapReduce views to allow the data to be queried and graphed in a web app, before importing the data into a Data Warehouse for ad-hoc analysis.

## Importing data into Cloudant

The entire data set consists of over 19m rows and forms a 3Gb CSV file with the following columns:

```
"{D3264840-681F-4FDD-8112-0000488F448E}","240000","2014-11-21 00:00","IP13 6SU","S","N","F","RICHMOND","","","BURGH","WOODBRIDGE","SUFFOLK COASTAL","SUFFOLK","A"
"{0AF11CD7-B529-4F63-8AAD-0000D6FC1C25}","123500","2014-11-28 00:00","CF61 2UQ","T","N","F","18","","GREYS DRIVE","BOVERTON","LLANTWIT MAJOR","THE VALE OF GLAMORGAN","THE VALE OF GLAMORGAN","A"
"{254C4795-8D7D-4EAB-9208-0001C03C5776}","186600","2014-12-03 00:00","SK4 3BH","T","N","L","6","","ROSGILL CLOSE","","STOCKPORT","STOCKPORT","GREATER MANCHESTER","A"
```

The first problem we need to address is the lack of column headings in the CSV file. The column titles can be gleaned from the 
accompanying [guide](https://www.gov.uk/guidance/about-the-price-paid-data) and manually inserted into the top row of the file. 
Without them, our importing script will not know how to name each column.

We can then use the [couchimport](https://github.com/glynnbird/couchimport) command-line tool to efficiently import the text file, writing blocks of 500 documents at a time to Cloudant's bulkdocs endpoint.

Firstly, we install couchimport:


```sh
npm install -g couchimport
```


Then sign up for a Cloudant account at https://cloudant.com, log into the Dashboard and create a new empty database called `houseprices`. We then need to construct a URL which defines where we want to the data to go. This is expressed as an environment variable, like so:

```sh
export COUCH_URL=https://myusername:mypassword@myhost.cloudant.com
export COUCH_DATABASE=houseprices
```

substituting your own account's credentials accordingly. We would like to filter the data slightly before import:

- Remove the double-quotes from the CSV.
- Convert the price to a Number data type.
- Convert the 'new' field to be a Boolean data type.

To do this, we create a `couchimport` transformation function in a new file:

```js
module.exports = function(doc) {
  doc.price = parseInt(doc.price, 10);
  doc.new = (doc.new=="N")?true:false;
  return doc;
}
```

This function is called by `couchimport` for every document in the import stream (on our local machine) to allow custom data 
processing to take place. We notify `couchimport` of its existence with another environment variable:

```sh
export COUCH_TRANSFORM=/path/to/transform_housedata.js
```

The COUCH_TRANSFORM step is optional, but without it all of the imported data would be treated as strings. We can then import our text file with:

```
cat data.csv | couchimport
```

Alternatively, we can supply the transform function and database name as parameters:

```
cat data.csv | couchimport --db houseprices --transform ./transform.js
```

Once imported, a typical JSON document looks like this:

```js
{
  "_id": "027d577963bb293de55a85bfd30009f4",
  "_rev": "1-b1e554507938c515c031e9eee5fb6694",
  "transaction_id": "{0ED12A59-C13A-4558-A14B-0D07D375219F}",
  "price": 44500,
  "date": "1998-02-27 00:00",
  "postcode": "SK4 3BR",
  "type": "F",
  "new": true,
  "duration": "L",
  "paon": "7",
  "saon": "",
  "street": "LYCHGATE MEWS",
  "locality": "STOCKPORT",
  "town": "STOCKPORT",
  "district": "STOCKPORT",
  "county": "GREATER MANCHESTER",
  "status": "A"
}
```

The column headings have become keys in the document object and each row becomes the value. Notice how the "price" field is now a Number type i.e. it has no quotes around it.

## Querying the data with MapReduce

We are going to create three views of the data in the same Design Document:

- House price value by full postcode.
- House price stats for the whole country by time.
- House price stats by postcode district & time.

Cloudant's MapReduce allows custom indexes to be created by emitting key/value pairs from a Map function which is called for each document in the database. The key/values are stored in a B-Tree, making for speedy access by key or ranges of keys.

Our three map functions look like this:

### Map Function 1: House price value by full postcode

```js
// emit postcode-->price e.g. TS55HJ ---> 125000
function(doc) {
  if(doc.postcode && doc.price) {
    var p = doc.postcode.replace(/ /,"");
    emit(p, doc.price);
  }
}
```

The map function strips spaces from the postcode before emitting keys of the form:

```
AB12XY -----> 123000
AB13YZ -----> 126000
```

This gives us a means of finding house sales for a known postcode with one query.

### Map Function 2: House price stats for the whole country by time

```js
// emit date array --> price e.g. [2014,3,25] ---> 125000
function(doc) {
  if (doc.date) {
   var bits = doc.date.split(" ");
   var date = bits[0].split("-");
   emit([parseInt(date[0],10), parseInt(date[1],10), parseInt(date[2],10)], doc.price);
  }
}
```


Splitting the date string into its constituent parts (year, month and day) allows us to build an index with the key made up of an array of year, month and day integer values:

```
[2011,12,25] ----> 180250
```

Using an array as a key allows results from the view to be grouped at query time e.g. group results by:

- Year.
- Year & month
- Year & month & day.

### Map Function 3: House price stats by postcode district & time

```js
// emit postcode district + date array --> price e.g. ["TS5",2014,3,25] ---> 125000
function(doc) {
  if (doc.date) {
   var bits = doc.date.split(" ");
   var date = bits[0].split("-");
   var postcodebits = doc.postcode.split(" ");
   emit([postcodebits[0], parseInt(date[0],10), parseInt(date[1],10), parseInt(date[2],10)], doc.price);
  }
}
```

The third index puts the first part of the postcode, known as the postcode district, in an array with the year, month and day, allowing us to see a breakdown of data for a postcode district by time.

### The Reduce

All three MapReduce operations will use the built-in "_stats" reducer that performs calculations across all matching rows to allow averages, maxima, minima and variances to be calculated easily. The built-in reducers `_stats`, `_count` and `_sum` are written in Erlang and are much faster than user-supplied Jacascript reduce functions. The rule of thumb is "if you're using a custom reducer, you're probably doing it wrong".


## Web App

We can then create a Web App that interrogates the above views from a user-supplied postcode and presents the results 
as a page of HTML. For a given postcode (e.g. CT20 1LF), we can query our three MapReduce indexes.


### Find all sales for a known postcode

```
/houseprices/_design/fetch/_view/bypostcode?key="CT201LF"&include_docs=true&reduce=false
```

- `key="CT201LF"`` - return entries from the index only matching the postcode supplied.
- `include_docs=true` - return the body of each returned document, not just the 'value' from the index.
- `reduce=false` - do not reduce the result set into a summary of stats. Even though we specified "_stats" in the Design Document, we can switch of the 'reduce' step at query time

The returned data looks like this:

```js
{
  "total_rows": 19582215,
  "offset": 94,
  "rows": [
      {
        "id": "001450e5de50e5f194793af80b0009bc",
        "key": "CT201LF",
        "value": 118000,
        "doc": {
            "_id": "001450e5de50e5f194793af80b0009bc",
            "_rev": "1-676e9a7ec10222f86beaf15264bf30dc",
            "transaction_id": "{C1220587-B57D-4293-9D7C-A6DA9C09DC5B}",
            "price": 118000,
            "date": "2005-01-14 00:00",
            "postcode": "CT20 1LF",
            "type": "T",
            "new": true,
            "duration": "F",
            "paon": "34",
            "saon": "",
            "street": "CHARLOTTE STREET",
            "locality": "FOLKESTONE",
            "town": "FOLKESTONE",
            "district": "SHEPWAY",
            "county": "KENT",
            "status": "A"
        }
      },
      ...
      ]
}
```

The reply consists of one row per matching house sale record.

### Find house sales by postcode district, grouped by year

```
/houseprices/_design/fetch/_view/bypcdandtime?startkey=["CT20"]&endkey=["CT20z"]&group_level=2
```

- `startkey=["CT20"]` - we perform a range query in our index with the start of the range being the first record in the postcode district "CT20". Our index is an array, so our query parameter must also be an array.
-	`endkey=["CT20z"]` - the end of the range is the last record in postcode district "CT20". By adding a "z" to the end of the string, we can simulate this condition
- `group_level=2` - we instruct the reducer to group the selected items from the index by the first two elements in the index (postcode district & year)

This produces a response like this (truncated for brevity):

```js
{
  "rows": [
    {
      "key": [
          "CT20",
          1995
      ],
      "value": {
          "sum": 19082429,
          "count": 406,
          "min": 7000,
          "max": 312000,
          "sumsqr": 1353768122851
      }
    },
    ...
  ]
}
```

The result contains an array element for each grouped key; one for each year. We can calculate the average house price in that year by dividing the sum by the count.

###  Fetch the national average house price, by year

```
/houseprices/_design/fetch/_view/byyear?group_level=1
```

- `group_level=1` - we instruct the reducer to group the selected items from the index by the first element in the index (year)

This produces a return value like this (truncated for brevity):

```
{
  "rows": [
    {
      "key": [
          1995
      ],
      "value": {
          "sum": 52649054835,
          "count": 766146,
          "min": 5200,
          "max": 5610000,
          "sumsqr": 6237266747251443
      }
    },
    ...
]}
```

The returned data includes one document per year.


### The App

A web application which uses the MapReduce views to present the results in HTML can be found here:

-	Source code - https://github.com/glynnbird/houseprices
-	App deployed on IBM Bluemix - http://houseprices.mybluemix.net/

## Data Warehousing

The MapReduce indexes are excellent for operational querying of our data store, because we are answering the same questions of our index each time and the indexes are optimised to answer those questions.

If we want to ask ad-hoc questions of our data set, then a different type of database is required. DashDB is a Data Warehousing solution from IBM that has close ties to Cloudant. A database can be exported to Cloudant in a couple of clicks. The schema of the SQL database is devised automatically and then queries can be run against the DashDB in SQL or R.

A DashDB data warehouse is built for offline analysis of your operational data as it supports ad-hoc querying e.g. to find the towns with the highest average house prices we can do:

```sql
SELECT "town", AVG("price") as p
FROM DASH109999."houseprices" 
GROUP BY "town" 
ORDER BY p DESC;
```

We can follow a similar procedure to import data that links UK postcodes to their latitude and longitude into a separate Cloudant database and then into its own dashDB table: "ukpostcodes". The raw postcode CSV can be downloaded from here http://www.freemaptools.com/download-uk-postcode-lat-lng.htm.





