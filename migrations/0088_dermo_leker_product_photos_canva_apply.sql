-- Dermo Master Barang photo refresh from approved Canva 1x1-clean-v2 assets, stage 2/2.
-- Exact Canva matches get the new image. All other canonical Dermo Leker outputs have old photos cleared.
-- Non-Leker products and all other stores are untouched.
-- DOC-IMPACT: NOT_REQUIRED — store-scoped catalog imagery only; no API/schema/contract/runtime behavior change.

INSERT INTO dermo_leker_photo_source_0087 (product_name, image_data) VALUES
  ('Leker Oreo', 'data:image/webp;base64,UklGRgQEAABXRUJQVlA4IPgDAACQFACdASpQAFAAPtFUoUwoJKMiLhoskQAaCWQAyQiJAeCkc/DZQ+Q5bKcvgJYyk1uXFpYmhFd9Zt38TETW9NxuQ1U93+IA+8TyN/C7QjXT/og4T09kC32If7tdn56zYTMEA3IXcmSzLWzU+QytUHcYk5HqH9Nf9/hxpAAV8hIiQIQltCN5i0AUE0w+TcjR1cJZg12eXdKy2YVDQ6vYc5LUyyq7byC0SNbmy4pbuAD+/zgoAYXb4KdoK+NOz9w4/MVernNEWAJ4hNYWqE0R+nMi8O6NXOuRXzNqzH3rdd3IkRTMM3sSd86R6XTsRoPSXXomCrR9PfJGrxXSdDzpYWS7dY1Wn96+cK+WvN79tevE49m3mJ3/3mK7NYL2R9qGQrG8t4W3t2Uw390lH8Sc2uo4pi+x+ItJYwru6kTeWLgHdHFwGVK1DtWPlIHl9gYBP5tCDdUp64WkS/PvAJpSRbHXYltMXaSGD0N2jBizCXPBOsj2lQXiRuheyQYdnUOHwabL11RSMVPNgC2bJzS7y6DvrIR8DOipb+0MboRLAEUIve+plN+gloT68aHDEtR3yH4JXchqDFUA8JZO/Ro9gYC1Uu5T5p9WrA2q+eL6INzq/ceT2epC1S/MAPOe0bQGbbm/1sIn4goWgUz+KgxrCvzvRDomWPYEmO5RJDgq8owR6WejHFsSCky0da+aubqpeZjsrdaQI4KyaNXQMN/mlKOPBwqym5A2TRxJGAaIaakCZF2zv0shLb2C3GbAQJeodH4PivcjgYHrVSSR/kFbUh1lDbSKm4NEw3fJ74OH94WtTOsWLwG+yKq6pBTv0Bu4ydcgLb2O3au/amzAw3A3I+uAbk9x7ON6R+j/Y34pL7kCfoUBo3b0aLvYngSuLk9/sdrsY2DUj3wSxzehkf1zh+CRLfJZmuatN9qm9/vA5fxRAjiVwFyWFHjVnZQMbxGZ18SoXG+TW6mvgO8/qIs1DCG7+1voH7SqNRJaFWzaRUVRBEFfT2vHuoxD8++6XtIZfI14dDuhAveToyjsqccF3a3mz0Mh+Jhl/bY4j6yrOfJ3LrG35ZfwxNQbuFiQvv3i4IlN48g865ZBb++TkATo9P1jFAgeriLX/28wvhbBofp/3b5xvQRYMRlTgzPIUSGiIYyaegR6sGDRErGuH/zPaf8wECThT5gDY5cw31nC4I6OjemXMmvNWDFa4AXzCGvi8o4APNQTsl1DglsRgX8wsV8QzAiGw6zcv4Ex2YXtbV+xt0PNoAQXjI+x+joqjV6qwCrTvu5SduiaUAOipf9WANFxts7KaGKqFYJXzEWcZjXaRaPOIDeKD79lpk5+SWBLWttdeIFeHkAAAA=='),
  ('Leker Blueberry + Gula', 'data:image/webp;base64,UklGRoQDAABXRUJQVlA4IHgDAABQEwCdASpQAFAAPtFco0woJaMiLhi62QAaCWYA0QBDDNBwvAxoNuR5gPPtspCfa814m5wfUZ3ty4IdlohXMbD2JvKpBP+HnG7PAaLebdfHCINH+rntRNlb6b1E8U6uAD6We112AOS9dt/uUccGWVItpn9vevK/9Cr09O8wAAta5AmLLwznd8KGk2aWhDbog54dxJ54+9FUxdcG22UBwsaYGeoAAP76toAhgSRX6HF/PFg+mDThS/36n632ebKf84o1UF965gbllSSbSLmggD+yuvhNVLeKQKXbx3S0bPfD1LjunYCFE3P9uPLw6tgCQGmOWQ2+ho3UzbuKeWepiKEFzQSXdlPXpA46x0Kjp0TKEbgMCshfaWPlZ5UeSIko8x8WMEF6Z866Gy4moiouI/gBRPtSeySbv1gaHUvSGNTr0CRsnnf5DI6pOE514Tgb8eD2TtbD4wvkwtHbQyCdDHQ7F2U/JyBJQxPBfWCiKGgBQfCOA1txPpVmiHRBdBtB+aLNhuisZ4OVjeoxPcdWOFjchkhDKDIfGWvmTQOBlFUTA0wdsaEEKhPMr36LYn7PKMd2saRACJptItnyf8KdM2eZVPTHq974OHcZTSmRqLiVw6fCBGonmntnsGfVU/k0JRWHosFg9EZHLKqxiHDDhRG1kJN8k++ZByTUFdrZ0EpU70IGEEuUTaRbRFTY6Qn1inFUoI6R5mr3f6UgxFK+5uEDPSSw1dvuCBJS+3bnKQa/R9pyUyiSXxrGZmx7tZVhytlCQOs7yUcJr5685BEaDqgzx2ECpxbmj9n2HELZDj8KfB5urJBmOp9y2pxMLE4XoBXTI+C0ONr2SSh7neoWnyiJeEOd/oQzbWaC+184e/e0FGzq12Y+sdoeFK5xIaDW/JO6FXTVvgsMcdM8o9j3kgV1LZHmf9hEhBMpJjqFZjexqIycAyVxk6lRprqknoXs5mH043ACyHyxYo0S3magbo7GBbh+qZCLa8Luk6b8nue94ZC3iJvOLBzeCho6edDLCHczzrONuauEnhCtnXthTPR+jYE3x8NepyV0QXT4wGe7ZPbcdy0nvZeZLR8sCWywOS02/90Lip7K3VrYa/l86mcOg1HHkOopZBhF6K9NIPzTATDdKtBAyfoAzeuzcJ4dOgDvPNHl1dC7tjZ0LeW84kSXAU7tACVIAAA='),
  ('Leker Choco Chips', 'data:image/webp;base64,UklGRsgDAABXRUJQVlA4ILwDAADwEgCdASpQAFAAPtFWokyoJKMiLNmcyQAaCWIswANp4QEQwPqafPxs2Dw/GrXMy4tLu0AcjmUuGi6yCk6w4YAwBa3CYr1N37SqOADSDzXvjwfxdZw41eCSrt+6h7b+z67v8xhy4NkXJV31OPsh6d/KOeQ4IDuIfWNGioHxEGqIMqxoR+V9zOrhT61Ya+/LvWPmk0Sna7UpCE1iadk1YGMgAP77KDY245qg6uYoz7iAhnKZMOeqwjvsLrBwHafZucmFobI88Qe/pytwo4NZ6ivhviOF9TcZ7An6wtPC6GZpsDSuhw2GGQl+ZpwItP2aOWeX2jiCEKEBQodr/PgZ9W0yMDSzhXTG/xfN1GmJLTWKb6yfekHhbuDSRlnXCDdfIwgWF7iZ9ykrsBqgGQYM6joqyRN1ZEAu8gnjJHcBKgri4ZUwGoa6UYEu1RlTgV9PdrFaeRygl3e5WEqfaOwbahzIPsWNoKDonh1HAPe8dzquKbaUoUOHXWyiFT+NxTcIQ92E37vnnWBuAbvaayd7icceEODSyQ/ER6nNJWhl7kc3ERM9t8akdzCXyyJp9f/iaptzNGUx8vumvpbedZTddnrEURKiKUstYnKu1MdhOfQPsowfFL9GYvQfRC5VfyRotubv7d6xPKNdske5P1K05PuFjfBX+gChe2FMNqpfM6kubtQEAPW/qoj/q8LXSFlvwPJA4JA1HqOXF5yKQ1Mec88dVwAl89K8hpTifhVXpLB/ZeNUsQN4PH5rc1Z8RpdGXTVE/HhRaZNHDZ1bGjuddbaFQYeVmld4kU6Bg+rXinst48Izb+K8bKzfVuSSdT7xVvb1dR1zCBx16ia88LjxeAfpHNgHaIEZlRkmyV6OSOm/bpSvPZfYJysOR2LvGcNz52RM/J+USmyq6YxgEsqt8yMk6BAB2jfRWL749LFhxOl3W/8ORog5BaSQ4aJ/uRuSYbD3+WAKv3xreEVQM4v/WVZQ9TmdbrSqTk85wm3QA9Dnmkjgn+9Ud/X9PZmk3qwEvGny/1g+LGrMPcZve7FDq+XHcyYRWIkaALPALy+Zm6MfMGQrVu4yrtdZI1NNiTnva/k1asrNXCzPAL/Vf8jTqfwCCj7gWBjCMFTuDzHBYLanKUI6PMCGP/xaCFqKfN2aDeHbtvRAUJp6UZ7Cig8pSrSqLuLZNnnIYwroC+C+2ZIzLTTitFCAZ4T6qyYgPtaDHRRTZ96QyGjXAe6hxnNlpIlXr3WhRjqYUThw8ZreA9C+Llf8dSL5S6AAAAAAAA=='),
  ('Leker Strawberry + Meses', 'data:image/webp;base64,UklGRnYDAABXRUJQVlA4IGoDAADQEgCdASpQAFAAPtFUokuoJKMir1v7EQAaCWwAzuR3ScDEuqRs9vTz3PnYb67ArHuplvdo3asPFBV5P/y13XRD7oFCtg7tzy7ul48q+ernwjToRY402nYV7BMBiZgrbx5ltPMgQzzpN1yKDQxszf47pyzyCDhRkhGDVi1veJ6PJaKM+kTT4zleyV0ZXY820PadUZ/xcVCS2E0bd+d5xAA/vs4jtqr2A2cB9aR5vn5gMfVUiNEIIJDsLF3Izgkt9OHWmOTZwL2ZXxrxTov1evtNNGpl3XiBAk9xAdzJOOuHfskjnKS7pIE82McSNzvuw6fQm5CgwSe2WMvYGefjLJreN+nw1HrI9cOHY29RCmVGSe7WhmuqP1GHA7Hpi1tZXDfg3oQoNBR1V8JF57LNAeaT03yGKiwcGUubI0V+fGMbo9MqH2p+rKXw8GRJ4ndGTHTb8NPdS6tUT+8S/ujNo8VLdWOYRrcN1kfWrAp7/5ojo8W+TF4WmSRS4qCrJ9y3hgX/4bPeJHsk0YPXPqyPxSL5OuEwb0PqnQCd/et6tphv+upla5l2z9VZyaRk/ztxzvkLSW786wcONVON8tiwBjrJ93C44i3c1y0MW8gHJEtnBsivmG8AG4L+TYL1BEtj0c5cYOFSl9XqDe/Vbg6IHTuqouZL8T1lRt7/5Fc6C+KkoJF49HqCfX5nZxrIoluFYk/mYupZH+lP1XeQ4uyH633OsLRUNAHwsc922gamPH1bh1+7zi5Bzsm5lqs0WaNPTVGyowOZTgvDsatyhY6BkAQXe4chfTe2kctIdecvYSDUJ9f3zNXe823IIklyf0nqq3jRJM+L7jvStjUPHLHUR9QAVPQL2QDya08EE2xiN2XuKtBw60ie8IFWBzVRhe0dheUBtoV/DJkOWrFBzHI5CV1NDiMhjzLQ4kyHemVoveJjAdN/nAtqzznd932HO0M/nXf4CxZ0fzW6E/tvmTy5b0UT6k1rG4c9V4cVbuE8Sy5PHV7E7wxZl5zBMOU7xywKL6czIe5A4qcawVhYf3FbZzYtieFK3dV/AAreweseyNmhqWZ7jiuvehgF0upaj25VCjlXjcgPiQDyhPx66anCPfQuVc3THeBKFkKNorcqIfimXBivEji3L2EdjRzzw2q99hdpQAkQQEbNwAA'),
  ('Leker Strawberry + Gula', 'data:image/webp;base64,UklGRm4DAABXRUJQVlA4IGIDAACQEgCdASpQAFAAPtFUokuoJKMir1v6cQAaCWwAzuR3ScC6OkButvJ5gPO887vfZoFY97M0LrC7Hibmluq2crJZcKWjVLdsPp+9Sh7NCU72h6hdgbdmsZvcKkTBy7HXGxk3IxtIKtreTZBUTRpwjsQ6IpXDxHRy60QsvMtS49kJ+iANXlzFKY6pe7IzimS7lMgvgYlaTiNTInlAuFYAAP77OI7aq9gNnAfWkeb5+YDH1VIjRVUQaVRWBK5uAa0G+KWa2+9MY7jj/+gWOq0hlYGtULRprAHF+X/3ydGfr6SU9KN/v0EqVUsVzy2Ox/ZlFumFT3RqIrJLKdDnHVv4lCxuxVbxptM2pDKku2m1yErghgE+SLfcihdr0iyYbHCW7GV5n46sobUVMYKlJTftvk9aWU2p6PSmbPpM+PF1c9elIw9T4KdlNkSTmykk9B1QcSb167s7oueNHFkiHI3AXJW6NUB93bDnJkHxhgM7V+ThOtDcqG+jkiMPYoF1tX5Z8xxXRu+oRleoGH1YOi7WblgnL8yX6sPhPBaQpdSQ3hmIuFIefiltH9MDuFtAZO8jZR5siUtqjXXgmQ6CmE6Dyo1rCtq+ZYcIIqpkN+Dtt95JmjFUXXYGKtbBjC++HMA8/HLhX1HDfUMxsE5zryr9+Q/VkNT/Y+rfYaDZ2T9PcWbF1lfSnYL602OWfIluwCda2Anfc/UUh7ydjSPQhLHBKOPCSm783R/wkPnOLRtUjCb+lDi5Bzpw0Q/8BKnRo9l+ume+1C+QLb282jkRGWfqVVA5C/69UArwSH+o+s0fIZ9m0AcrPHyZkNJUHrfa1DbfJ/oig85mLty145Y6jHqJ/i6zBh+PH2Er1WZppFWcyhHW2JMnelApxcDCd9mcdD/OZJB2jn5LltSApyvcdCbN8fF8H3EtDsZYd6Zd096EzlZunpJ+NULVBHVrS2fEWkBLDphz15oIlFxZ8YQ+zpsdS7ga3xIQ6TAiSxKEOhJdiYAio0jqZ20P9RC4TXe0WzL3UCM9vAFq76mDTgJ+o3B+eXxwfykeXJZxakpDiYVNG1ur6dNVQ/sq9Vgl/3jhxYFJs/cr1O2vDyhJgzQi7gDmM3Fpar1d42cHEciww6cgmwUT4tKE/PyHkF5/rsXuk7DdtgEAAA=='),
  ('Leker Green Tea', 'data:image/webp;base64,UklGRkYDAABXRUJQVlA4IDoDAACQEgCdASpQAFAAPtFaoUuoJaMhrhi9IQAaCWgA0BBMijlTR+Qd7c7n1dMrfUKdkfXkx1qVx9U5i0Kwhp9/ld2H6oU6+BVHr0xLQ4lczQZ2WK1KgCs25RUZAvrVhUSXMJbFLueeny3yz2PkWTGD6n4wq6P5/ikEzmR78yYA8vLPCuhyL4j1r/TbrguIKWdRPRYzj0J93M5aIpsEpgqAAP739KS/cVBofX9GFKgDpm4zzVjQVWx1tXvsxBGK8w4DiK06rBi5xbaWN5JiZx/uAK49D4B2dIRnmJf7lwu1SbBRgE3haPcEGyfC3Sj3x8K/WdEW62DIs6fxvA2YkLMA6NooTzCc4t5/k0PTR3V/kaZVrrs/ozJPaal0guZ6NbAgHVmkLZylCDk2t/3KmUWmQD6OPSDOXEFkWIfpvaEwSSCPJXWUWH5QFkj/enCKW88U2Hus5FH/aM7Q6D3R5qpocFyU9tiP+DvYTq5R0Nido76HuRXobzqoWZQVFCCzLAxpCvJ3rfDOy3eOceYLM2ScQ6/ALrs23/AgzeJez0ElO6SmAhUGdgymBZ8j6BGWjI9fjVew7kdCbyaMkOUy11FmJliNau03hO1S623rmSdwcHglADNsWFa/i+HoaiAwFG8jakG/xKx6VAsHwWdLmxeLrirNFbgpiWktS7k/1oAbNqJg7sJM760oEYJVyLzmdbc40l4V4t0cCcKcoInb6fGOsY9A8c4bZ2OeR9hOQxzSnVY/sS9YHP7E+Ce6a5RGYbOXkutzyvwCNG00G14MWR9r7kaSRCrbA7qbWKPbRp52LVrpIXxZdyNR+k5AF5E7yUkD7o/+4pCN4YSc6DFNgl38hzZzq7SFKurKEoUZHX26pnH9FbQi75yBQi9LfA1v5YKhHsfOYfBIJf2M0q0Xtg2WNTLQm2ruatuFxtWuyfUhv9X4qA9ICR54VOxnz2DlQR0RsHBXqAp3M1VWCrrXm+lt/xU5mmfi2l7Q5rSigePG1RD65p3nut22j2Ry8dowLBFevoNKC30qn/46Q3pD/3Rry3bq7804y3tng15ZyNYS+Pf8vxj3RjQFq6GJoDqqwoHMAvKjCGebngokqAAA'),
  ('Leker BlueBand + Keju', 'data:image/webp;base64,UklGRmwDAABXRUJQVlA4IGADAADwEwCdASpQAFAAPtFeokwoJaMiLNs7uQAaCWoAyu4cXn5pUgjytIG4A57PTgIF7+WMt7k84BVY31cuPl3x6sHPLDe3CBAV2X+Vg0O1TnMzfW1rZjlk9kvXFO/2FE6NKvrjKjNNIePA4rTQh5u1e2OdOL4InTNLDMoCylJ4KTkuwn0mB8XQWypDKSqvCu7SDNR1b9Xnt5JoxLGd0v7X+hUFwvNKv1rsOwAA/v33F/Nu0ScAv/AZM/AQ5rDnZuNUIcqIgyHD9YzZOxhUIAZxI1U+fMQnMo+ctynkShW1tTtJ8xq/sFCzBWocTwfbfK1fqxBu2nMaaUBqXWP/R060YwB9UZem3QgtK1PknB2gpZPPYnF6zr43q9t06FpzjDVx7dUYW93XsLFF7QFNJcmbqaSKc9D/6fZ0XlkhmPr32+N4MLEZvLSCrKb9W3beZHXV8E7KBGt+RPLbQHRt8e77k0Cx2W6uIXct5QR/2dF7K7ZTo4cWJOVZM63QZk0zgzahfdItJSsVdMU5vgqtCnFHkJhJapdIdeDOjiUuAiw3mHyoosWj8E9HCAkoryYnj58+9Li3c7KPpy6lqAeUgNLv11k29/F9F9LaRzELijSzmW4cRPUJaXp1AXP6WrMmXePKurZuFfh4s71uEcQsr/GdYbLnYb4V9wk04dwjgFbY/DLWZESEve3hYEuLduwaLcLYcV+dPPStfQoxLjrr8ubCkGgUCR/noMeVJcoPxcbV65pW9dDPKqerJIIleZeLc3cviWrjKlv11lvOIS7JVmzkKymVpFZCE7ajtaotCYZ2DYZPpqjgkICpQvL3QjcQSpQHUp3Cms2BmsHdH+l4mLApwW48uKQsEAm8xMpZLX60f55cAv4WFncIW70CmJagIbDMGab/QdtnMOe+8hpSKO80BnuHskdVKm/LdQBUEz+yvIEOmner5v41ky0b7nzzqji1PlI7ZZ2OCTJnvHwXC6nXVJ62V2E0dGRte8Hc6bisstW/7M4rn6v7JbIiE2WtWuXuIXAP3K7LpGh+awWc7DTuE11bJalLVy1y1Gm0eIMM5g/eB2ebqHyDWBxnmR9Z5kXWHuElZEpeka1iEXECq2kYHoHjmZy0f33+qTmxysRu/524raFreo7o6b+hqIt+lSIAAAA='),
  ('Leker Cappucino', 'data:image/webp;base64,UklGRjwDAABXRUJQVlA4IDADAACQEQCdASpQAFAAPtFYpEwoJSOiL1lZ2QAaCWIAz1gwUQ1sNvpdksC9/SmONvucesQbz+zhHML95orW4kpeylVUgQ3c2JpFH3YbkYkJBlVoXMD3dmk31kpSTGAcloAWmiLjbuw49yvgSmh8C21N24JMQIoSVsGE+5urea4UWe5WpdyJbziCPIPl2T+Sux/jREcX/x9oAAD++raA13sNWNr9hRYMRdXMguqLT2ZKEoOLSKIf+iZUNd1K8ZYSwLXyHvAOYr3KR7l6JZzF/tOvs94khd2yfuGfoJhmemX/HB7PtVpd8BXq+WhqTyog+C7unOB/LQrpBsGqJD3ajAjuV/uIhAXwUEW/WsjP64fKDTGmDdns4jtvT+R1jmAj/NwSTFHDdg2ol15KyJWyQDuL5pVukHS9Aod0gvcHJL0JvPWQ8q9sjqKqZFILJKfr2SFd2C1rqEsVCoDraz500uzAoRteZudp9UEcRoUesUJYKUWJweUSBjWcT6/ZdDtVqBZfY6wuqefv/Ihck1janv/hbC7hL/Nx/aq/oG7I5SGYGIhxLiqbGemps4SJ2yEOz5fX42+O99B7JYNRtPer7oAO6gSUeCVRfiwagezmjzvkEZc0YzpfbkedQ4wvswb8q7S40VXW9Tc6w2AELVS7/kkNFqMPs1BdvUqch6xuWgLUkswi/ri++4pX4STkHS5EVQmYWi4UDHqvVlD+nYLgQsknsRiCdNZdX8LvVd4qXPeOYf61b1O5UELzl9yOEQfTzBvtDUhzGJz4zSRuRji5bdoFJHnpf3bJNm4S9Lv+Tw1bi4ISFMsekzugJ43l1YkS13Fl3oWbB5HWBtRs/WkL1sNmfJWkk+8Tl009ZGGPW3VYQxGnCQTO6oHbbQfUt/lOsIaoNAMXwROje80Mxcztm/+9Nk28HWcJrB0GaBEsrahpbRzHBGNgHIBb2NUVpf6m4TPOFhJyIIy4GZsuguxrsGqJmGyc9qjRGWwde+WQ2h5xdJTldBYnLoK9W/qXF9CC60V3OrYwJDkJXP60IPnc6qZCnPPHDIG1e4ruOsbdCObxzf96oPDY3UC/I5fwGlJEUHhygAA=');

CREATE TABLE dermo_leker_photo_guard_0088 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO dermo_leker_photo_guard_0088 (ok)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM stores WHERE id = 'store_dermo')
  AND (
    SELECT COUNT(*) FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1 FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
  ) = 73
  AND (SELECT COUNT(*) FROM dermo_leker_photo_source_0087) = 17
  AND (
    SELECT COUNT(*) FROM dermo_leker_photo_source_0087 s
    JOIN products p ON p.store_id = 'store_dermo' AND p.name = s.product_name
    WHERE EXISTS (
      SELECT 1 FROM manufacturing_recipes r
      WHERE r.store_id = p.store_id
        AND r.output_product_id = p.id
        AND r.id LIKE 'dermo_leker_recipe_%'
        AND r.created_by_id = 'migration_0083'
    )
  ) = 17
THEN 1 ELSE 0 END;
DROP TABLE dermo_leker_photo_guard_0088;

UPDATE products
SET image_data = COALESCE((
      SELECT s.image_data
      FROM dermo_leker_photo_source_0087 s
      WHERE s.product_name = products.name
    ), ''),
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1 FROM manufacturing_recipes r
    WHERE r.store_id = products.store_id
      AND r.output_product_id = products.id
      AND r.id LIKE 'dermo_leker_recipe_%'
      AND r.created_by_id = 'migration_0083'
  );

CREATE TABLE dermo_leker_photo_verify_0088 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO dermo_leker_photo_verify_0088 (ok)
SELECT CASE WHEN
  (
    SELECT COUNT(*) FROM products p
    JOIN dermo_leker_photo_source_0087 s ON s.product_name = p.name
    WHERE p.store_id = 'store_dermo' AND p.image_data = s.image_data
  ) = 17
  AND (
    SELECT COUNT(*) FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1 FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
      AND NOT EXISTS (
        SELECT 1 FROM dermo_leker_photo_source_0087 s WHERE s.product_name = p.name
      )
      AND COALESCE(p.image_data, '') <> ''
  ) = 0
THEN 1 ELSE 0 END;
DROP TABLE dermo_leker_photo_verify_0088;
DROP TABLE dermo_leker_photo_source_0087;
