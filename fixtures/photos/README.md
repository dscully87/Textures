# Calibration photographs

Real photographs the engine is calibrated against (`lib/__tests__/calibration.test.ts`).
Each is downscaled to 480px on its long edge; the tests downscale again to the
256px analysis buffer, exactly as a capture does in the browser.

| File | Subject | Source |
| --- | --- | --- |
| `lake.jpg` | Calm waterfront, sky reflected in still water | OpenCV `opencv_extra/testdata/stitching/boat1.jpg` |
| `graffiti.jpg` | Graffiti wall | OpenCV `samples/data/graf1.png` (Oxford affine-covariant regions dataset) |
| `building.jpg` | Modernist facade | OpenCV `samples/data/building.jpg` |
| `circuit.jpg` | Printed circuit board | OpenCV `samples/data/board.jpg` |
| `fruit.jpg` | Cut citrus and kiwi | OpenCV `samples/data/fruits.jpg` |
| `candy.jpg` | Glossy sweets on white | OpenCV `samples/data/smarties.png` |
| `cathedral.jpg` | Dark gothic interior (greyscale) | OpenCV `opencv_extra/testdata/stitching/a1.png` |
| `aqueduct.jpg` | Stone aqueduct over a river | OpenCV `opencv_extra/testdata/stitching/s1.jpg` |
| `painting.jpg` | *The Starry Night* (public domain) | OpenCV `samples/data/starry_night.jpg` |
| `mandrill.jpg` | Mandrill face | OpenCV `samples/data/baboon.jpg` (USC-SIPI) |

These are test fixtures only and are not shipped in the app bundle. Swap in your
own photographs freely — the tests read whatever files the table in
`lib/__tests__/photos.ts` names.
