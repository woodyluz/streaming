export const API = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p/";
export const SA_HOST = "streaming-availability.p.rapidapi.com";
export const H = 3600e3;

export const COUNTRIES = {CH:"Schweiz",DE:"Deutschland",AT:"Österreich",LU:"Luxemburg",FR:"Frankreich",IT:"Italien",BE:"Belgien",
  NL:"Niederlande",ES:"Spanien",PT:"Portugal",GB:"Grossbritannien",IE:"Irland",US:"USA",CA:"Kanada",SE:"Schweden",
  DK:"Dänemark",NO:"Norwegen",PL:"Polen"};
export const GROUPS = [["flatrate","Im Abo"],["free","Kostenlos"],["ads","Mit Werbung"],["rent","Leihen"],["buy","Kaufen"]];
export const JOBS = {Director:"Regie",Screenplay:"Drehbuch",Writer:"Drehbuch",Novel:"Romanvorlage",Story:"Story",Author:"Autor",
  Creator:"Idee","Original Story":"Vorlage",Characters:"Figuren",Producer:"Produktion","Executive Producer":"Ausführende Produktion",
  "Original Music Composer":"Musik","Director of Photography":"Kamera",Editor:"Schnitt",Teleplay:"Drehbuch"};
export const LANGS = {deu:"Deutsch",eng:"Englisch",fra:"Französisch",ita:"Italienisch",spa:"Spanisch",por:"Portugiesisch",nld:"Niederländisch",
  jpn:"Japanisch",kor:"Koreanisch",swe:"Schwedisch",dan:"Dänisch",nor:"Norwegisch",pol:"Polnisch",tur:"Türkisch",rus:"Russisch",hin:"Hindi",zho:"Chinesisch"};
export const DEPT = {Acting:"Schauspiel", Writing:"Drehbuch", Directing:"Regie", Production:"Produktion", Sound:"Musik"};
// TMDB-Anbietername (normalisiert) → Katalog-ID bei Streaming Availability
export const SA_MAP = {netflix:"netflix",netflixbasicwithads:"netflix",netflixstandardwithads:"netflix",amazonprimevideo:"prime",amazonprimevideowithads:"prime",
  "disney+":"disney","appletv+":"apple",appletv:"apple",max:"hbo",hbomax:"hbo","paramount+":"paramount",mubi:"mubi",wow:"wow",
  crunchyroll:"crunchyroll",plutotv:"plutotv",britbox:"britbox",curiositystream:"curiosity",zee5:"zee5"};
export const FSK = [0, 6, 12, 16, 18];
