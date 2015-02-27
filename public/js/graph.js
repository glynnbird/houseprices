
google.load("visualization", "1", {packages:["corechart"]});

var drawChart = function () {

  
  // monthly trend
  var data2 = google.visualization.arrayToDataTable(trend2);
  var options2 = {
    title: 'Postcode district house price, by year',
    colors: ["red","green","blue","black"]
  };
  var chart2 = new google.visualization.LineChart(document.getElementById('chart_div2'));
  chart2.draw(data2, options2);
  
};


