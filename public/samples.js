// "Fill with a sample" content, so judges can try it in ten seconds.
export const SAMPLES = {
  viva: {
    subject: 'LeafLens: Tomato leaf disease detection with YOLOv8 on a Raspberry Pi 5',
    context: `Smallholder tomato farmers in Cameron Highlands lose up to 30% of yield to early blight, late blight and leaf mould because diagnosis relies on visual inspection by extension officers who visit monthly.

LeafLens is an offline mobile-and-edge system. A farmer photographs a leaf; a YOLOv8n object detector running on a Raspberry Pi 5 in the farm shed localises lesions and classifies them into six classes (healthy, early blight, late blight, leaf mould, Septoria leaf spot, bacterial spot). Results are sent to the farmer's phone over local Wi-Fi with a treatment suggestion in Bahasa Melayu and English.

Dataset: 4,212 field images (1,120 collected by me on three farms, the rest from PlantVillage and PlantDoc), annotated in Roboflow with 9,870 bounding boxes. Because PlantVillage images have plain backgrounds, I used mosaic augmentation and random background replacement to reduce the lab-to-field gap.

Results: mAP@0.5 of 0.87 on the held-out field test set (0.95 on PlantVillage-only test). Late blight vs early blight is the most common confusion. After INT8 quantisation with TensorRT-equivalent export to NCNN, inference is 118 ms per image on the Pi 5, versus 410 ms for YOLOv8s. A usability test with 9 farmers gave a SUS score of 78.

Limitations: only daytime images, single crop, and the farm images come from one region.`,
  },
  interview: {
    subject: 'Junior Data Analyst, digital payments company in Kuala Lumpur',
    context: `Job description: We are looking for a Junior Data Analyst to join our Risk & Growth analytics team. You will write SQL against our transaction warehouse (BigQuery), build dashboards in Looker Studio, analyse merchant churn and fraud patterns, and present findings to product managers. Requirements: strong SQL (joins, window functions), Python (pandas), basic statistics (A/B testing, confidence intervals), clear communication. Nice to have: experience with dbt, fraud or payments data.

About me: Final-year BSc Computer Science (Data Analytics) student. Internship at a logistics startup where I built a delivery-delay dashboard in Power BI used by 12 ops staff. University project on customer churn prediction with XGBoost (AUC 0.84). Comfortable with SQL Server and pandas; have not used BigQuery in production.`,
  },
}
