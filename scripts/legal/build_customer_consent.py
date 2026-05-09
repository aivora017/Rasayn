"""Build customer_consent_v0.9.docx — short customer consent (en + mr + hi)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _lib import make_doc, title, subtitle, h1, h2, p, bul, num, sp, br, tbl, hf

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "legal", "customer_consent_v0.9.docx"))

d = make_doc()
hf(d, "Vaidyanath Pharmacy — Customer Consent v0.9 (lawyer review)",
   "DPDP Act 2023 + D&C Act 1940 — counter-displayed + in-app modal text")

title(d, "CUSTOMER CONSENT")
subtitle(d, "Vaidyanath Pharmacy, Kalyan  —  v0.9 (Effective 2026-05-13)  —  English / Marathi / Hindi")
sp(d)

h1(d, "Section C.1 — English (master)")
h2(d, "Customer Consent — Personal Data (DPDP Act 2023 + Drugs and Cosmetics Act 1940)")
p(d, "I, ___________________________ (customer name), confirm that:")
num(d, "I agree that Vaidyanath Pharmacy may store my name, mobile number, and the details of medicines I buy from this counter today, for the purposes of issuing my bill, GST credit, refund processing, and the Schedule-H prescription register required under the Drugs and Cosmetics Rules, 1945.")
num(d, "I understand that this data will be stored only on the computer at this shop's premises and will not be transferred outside India unless I give a separate consent.")
num(d, "I have the right to ask, at any time, what data is stored about me, to ask for corrections, and to ask for deletion subject to legal retention periods (≥ 2 years for Schedule-H register; ≥ 6 years for GST records).")
num(d, "I have read, or had read out to me in my preferred language, the full Privacy Notice posted at the counter (English / Marathi / Hindi version available).")
num(d, "SMS opt-in (optional): I agree to receive an SMS receipt and refill reminders on the mobile number recorded above. I can withdraw this at any time by telling the counter staff. (Yes / No — circle one)")
sp(d)
p(d, "Signed: _________________________   Date: _________   Place: _________")
sp(d)
p(d, "Or — for in-app capture: customer says \"yes\" verbally → cashier ticks the on-screen check-box → consent record stored with timestamp + cashier ID + bill ID.", italic=True)

br(d)
h1(d, "Section C.2 — Marathi  [MACHINE-TRANSLATED — human-rev Q-010]")
h2(d, "ग्राहक संमती — वैयक्तिक डेटा (DPDP कायदा 2023 + औषध व सौंदर्यप्रसाधन कायदा 1940)")
p(d, "मी, ___________________________ (ग्राहकाचे नाव), याद्वारे पुष्टी करतो/करते की:")
num(d, "वैद्यनाथ फार्मसी आज या काउंटरवरून मी खरेदी केलेल्या औषधांचा तपशील, माझे नाव, आणि मोबाइल नंबर बिल जारी करण्यासाठी, GST क्रेडिटसाठी, परताव्यासाठी, आणि औषध व सौंदर्यप्रसाधन नियम 1945 अंतर्गत आवश्यक शेड्यूल-H प्रिस्क्रिप्शन रजिस्टरसाठी साठवू शकते याला माझी संमती आहे.")
num(d, "हा डेटा फक्त या दुकानाच्या परिसरातील संगणकावर साठवला जाईल, आणि स्वतंत्र संमतीशिवाय भारताबाहेर पाठवला जाणार नाही.")
num(d, "कोणत्याही वेळी माझा डेटा काय साठवला आहे हे विचारण्याचा, दुरुस्तीसाठी विनंती करण्याचा, आणि कायदेशीर मर्यादेच्या अधीन राहून हटवण्याची विनंती करण्याचा मला हक्क आहे.")
num(d, "काउंटरवर लावलेली संपूर्ण गोपनीयता सूचना मी वाचली आहे किंवा माझ्या पसंतीच्या भाषेत मला वाचून दाखवली आहे.")
num(d, "SMS संमती (पर्यायी): वरील मोबाइल नंबरवर बिल पावती आणि रिफिल स्मरणपत्रे SMS द्वारे प्राप्त करण्यास मी सहमत आहे. (होय / नाही — एक निवडा)")
sp(d)
p(d, "स्वाक्षरी: _________________________   दिनांक: _________   स्थळ: _________")

br(d)
h1(d, "Section C.3 — Hindi  [MACHINE-TRANSLATED — human-rev Q-010]")
h2(d, "ग्राहक सहमति — व्यक्तिगत डेटा (DPDP अधिनियम 2023 + ड्रग्स एंड कॉस्मेटिक्स एक्ट 1940)")
p(d, "मैं, ___________________________ (ग्राहक का नाम), इसके द्वारा पुष्टि करता/करती हूँ कि:")
num(d, "वैद्यनाथ फार्मसी आज इस काउंटर से मेरे द्वारा खरीदी गई दवाओं का विवरण, मेरा नाम, और मोबाइल नंबर बिल जारी करने, GST क्रेडिट, रिफंड प्रक्रिया, और औषधि एवं प्रसाधन नियम 1945 के तहत आवश्यक शेड्यूल-H प्रिस्क्रिप्शन रजिस्टर के प्रयोजनों के लिए संगृहीत कर सकती है, इस पर मेरी सहमति है।")
num(d, "यह डेटा केवल इस दुकान के परिसर के कंप्यूटर पर संगृहीत किया जाएगा, और अलग सहमति के बिना भारत के बाहर नहीं भेजा जाएगा।")
num(d, "किसी भी समय यह पूछने का, सुधार माँगने का, और कानूनी अवधारण सीमाओं के अधीन रहते हुए विलोपन माँगने का मुझे अधिकार है।")
num(d, "काउंटर पर लगी पूरी गोपनीयता सूचना मैंने पढ़ी है या मेरी पसंदीदा भाषा में मुझे पढ़कर सुनाई गई है।")
num(d, "SMS सहमति (वैकल्पिक): उपरोक्त मोबाइल नंबर पर बिल रसीद और रिफिल अनुस्मारक SMS के माध्यम से प्राप्त करने के लिए मैं सहमत हूँ। (हाँ / नहीं — एक चुनें)")
sp(d)
p(d, "हस्ताक्षर: _________________________   दिनांक: _________   स्थान: _________")

from _lib import save_doc; save_doc(d, OUT)
print("WROTE", OUT, os.path.getsize(OUT))
