
var submitPostcode = function() {
  var p = $('#postcode').val();
  p = p.toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(p.length>0 && p.match(/^[A-Z]+[0-9]+[A-Z]?[0-9][A-Z][A-Z]$/)) {
    window.location.href="/postcode/"+p;
  } else {
    alert("invalid postcode");
  }
  return false;

}