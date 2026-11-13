# models/vocal-yamnet-int8.bin

Derived from **YAMNet** by Google — `tensorflow/models`, `research/audioset/yamnet`
(weights `yamnet.h5`, https://storage.googleapis.com/audioset/yamnet.h5), licensed under the
Apache License 2.0 (full text in `LICENSE-APACHE-2.0.txt`).

Modifications made for LYRICS Studio:
- batch-normalisation folded into the convolution weights;
- weights quantized to int8 with one float32 scale per output channel;
- the 521-class output layer reduced to six voice classes
  (Singing, Choir, Child singing, Synthetic singing, Rapping, A capella);
- re-packaged in the "YVD1" binary layout read by `js/vocal.js` and `mobile/lib/vocal_detector.dart`.

The network is executed by LYRICS Studio's own code on the device. No audio leaves the device.
