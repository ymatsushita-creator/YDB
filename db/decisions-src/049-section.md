### D-7. 「募集期間」の範囲を outreach_start_date 〜 application_close_date と解釈した

年度サマリ指標の分母は「その年度の募集期間中に一度でもアクティブだった林の
実人数」と指示された。「募集期間」がどこからどこまでかは明文化されていない。

集客期に林が積み上がることと、応募締切より後に初めて接点を持った人は
その年度の応募母集団ではないことから、
`outreach_start_date` 〜 `application_close_date` と解釈した。
違うなら `getReachConversion` の1箇所を直せばよい。
