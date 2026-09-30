// Reference list shared by the console (Data & Assumptions page) and the submission deck.
// IEEE style: numbered in order of first citation; *text* marks italics (journal / book titles).
export const REFS: string[] = [
  'National Centre for Polar and Ocean Research, “AL/03 – Advisory for Maitri station,” Planning advisory, 39th Indian Scientific Expedition to Antarctica, NCPOR, Goa, India, Aug. 2019.',
  'National Centre for Antarctic and Ocean Research, “Onsite operation, non-comprehensive maintenance and repairs contract (OMRC) for Bharati – Indian research station at Larsemann Hills, Antarctica,” Tender Doc. NCAOR/LH(20)/2017, NCAOR, Goa, India, Jun. 2017.',
  'J. H. Friedman, “Greedy function approximation: A gradient boosting machine,” *The Annals of Statistics*, vol. 29, no. 5, pp. 1189–1232, 2001.',
  'J. Lei, M. G’Sell, A. Rinaldo, R. J. Tibshirani, and L. Wasserman, “Distribution-free predictive inference for regression,” *Journal of the American Statistical Association*, vol. 113, no. 523, pp. 1094–1111, 2018.',
  'A. J. Wood, B. F. Wollenberg, and G. B. Sheblé, *Power Generation, Operation, and Control*, 3rd ed. Hoboken, NJ, USA: Wiley, 2014.',
  'A. Parisio, E. Rikos, and L. Glielmo, “A model predictive control approach to microgrid operation optimization,” *IEEE Transactions on Control Systems Technology*, vol. 22, no. 5, pp. 1813–1827, 2014.',
  'Ministry of Earth Sciences, “Parliament question: Maitri-2 station,” Press release, Press Information Bureau, Government of India, New Delhi, India, Dec. 10, 2025.',
  'F. Pedregosa *et al.*, “Scikit-learn: Machine learning in Python,” *Journal of Machine Learning Research*, vol. 12, pp. 2825–2830, 2011.',
  'T. Hong and S. Fan, “Probabilistic electric load forecasting: A tutorial review,” *International Journal of Forecasting*, vol. 32, no. 3, pp. 914–938, 2016.',
  'J. Meeus, *Astronomical Algorithms*, 2nd ed. Richmond, VA, USA: Willmann-Bell, 1998.',
  'T. Lambert, P. Gilman, and P. Lilienthal, “Micropower system modeling with HOMER,” in *Integration of Alternative Sources of Energy*, F. A. Farret and M. G. Simões, Eds. Hoboken, NJ, USA: Wiley, 2006, pp. 379–418.',
  'R. P. Lal and S. Ram, “Climatology of blizzards over Schirmacher Oasis, East Antarctica,” *MAUSAM*, vol. 60, no. 1, pp. 39–50, 2009.',
  'S. Chug and V. K. Soni, “The long-term variability of meteorological parameters at Maitri, East Antarctica station of India,” *Journal of Earth System Science*, vol. 135, Art. no. 5, 2026.',
  'T. Tin *et al.*, “Energy efficiency and renewable energy under extreme conditions: Case studies from Antarctica,” *Renewable Energy*, vol. 35, no. 8, pp. 1715–1723, 2010.',
  'M. de Witt, C. Chung, and J. Lee, “Mapping renewable energy among Antarctic research stations,” *Sustainability*, vol. 16, no. 1, Art. no. 426, 2024.',
  'Intergovernmental Panel on Climate Change, *2006 IPCC Guidelines for National Greenhouse Gas Inventories*, vol. 2, *Energy*. Hayama, Japan: Institute for Global Environmental Strategies, 2006.',
  'B. K. Datta, G. Velayutham, and A. P. Goud, “Fuel cell power source for a cold region,” *Journal of Power Sources*, vol. 106, no. 1–2, pp. 370–376, 2002.',
];

/** Split a reference into [text, italic] runs. */
export const refRuns = (s: string): [string, boolean][] => s.split('*').map((t, i) => [t, i % 2 === 1] as [string, boolean]).filter(([t]) => t.length > 0);
