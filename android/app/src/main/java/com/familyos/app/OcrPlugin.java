package com.familyos.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Reading the text in a photograph, and in a PDF that is pictures of text.
 *
 * <p>Until this existed, the honest answer for both was "Google Drive reads
 * them when they sync". That is a real dependency on a network round trip and
 * a connected Drive, in an application whose first sentence is that it is
 * offline-first — and it made the <b>Scan</b> button, the obvious thing to
 * press while standing over a bill, produce nothing at all until the phone
 * had signal and Drive was configured.
 *
 * <p><b>Bundled, not downloaded.</b> {@code com.google.mlkit:text-recognition}
 * ships the Latin model inside the APK. The Play Services variant fetches it
 * on first use, which would put the network back in the path this removes and
 * would fail outright on a sideloaded build with no Play Services.
 *
 * <p><b>This decides nothing.</b> It returns lines of text in the same shape
 * {@code data/pdf-read.js} returns, and every judgement about what those lines
 * mean — what kind of document it is, what to fill in — stays in JavaScript
 * where the tests are. Same argument as {@code SmsInboxPlugin} and
 * {@code ShareTargetPlugin}.
 *
 * <p><b>What it does not do.</b> No handwriting, no non-Latin script — the
 * bundled model is Latin only, so a Kannada or Devanagari document comes back
 * empty rather than wrong. No layout: a table is read as the lines it looks
 * like, which is enough for "Due Date: 18/10/2026" and is not a spreadsheet.
 */
@CapacitorPlugin(name = "Ocr")
public class OcrPlugin extends Plugin {

    /**
     * How many pages of a scanned PDF are read.
     *
     * <p>Recognition is roughly a second a page on a mid-range phone and every
     * page is rendered to a bitmap first. A two-hundred-page policy would hang
     * the capture for minutes; the fields anybody searches a document for are
     * on its first pages, and `indexableText` caps the stored text anyway.
     */
    private static final int MAX_PAGES = 10;

    /** Long edge, in pixels, that a PDF page is rendered at. */
    private static final int RENDER_LONG_EDGE = 2000;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    /*
     * There is deliberately no `available()` method here.
     *
     * One was written, returning `{ available: true, scripts: "latin" }`, and
     * nothing ever called it: `core/ocr.js` answers the same question from
     * whether Capacitor hands back a proxy for this plugin, synchronously and
     * without a round trip. A method the JavaScript never invokes is the
     * defect this repository finds most often, and writing it here would have
     * been committing that defect while fixing an instance of it.
     *
     * The `scripts` fact it reported went nowhere too. It now lives where a
     * household can see it — in the sentence `identifiers.js#textState`
     * produces when recognition finds nothing.
     */

    /** The text in an image, as lines. */
    @PluginMethod
    public void readImage(PluginCall call) {
        String encoded = call.getString("bytes", "");
        worker.execute(() -> {
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                Bitmap bitmap = decodeWithin(bytes, RENDER_LONG_EDGE);
                if (bitmap == null) {
                    // Not an image this device can decode. An empty answer, not
                    // an error: the file is still filed, just unread.
                    call.resolve(pages(new ArrayList<>()));
                    return;
                }
                List<List<String>> out = new ArrayList<>();
                TextRecognizer recognizer =
                    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                try {
                    List<String> lines = recognise(recognizer, bitmap);
                    if (!lines.isEmpty()) out.add(lines);
                } finally {
                    bitmap.recycle();
                    recognizer.close();
                }
                call.resolve(pages(out));
            } catch (Exception failed) {
                call.reject(String.valueOf(failed.getMessage()));
            }
        });
    }

    /**
     * The text in a PDF that carries no text layer.
     *
     * <p>Rendered here with {@code PdfRenderer} rather than in JavaScript,
     * because {@code data/pdf-read.js} is a text extractor and has no
     * rasteriser — and Android has had one since API 21.
     */
    @PluginMethod
    public void readPdf(PluginCall call) {
        String encoded = call.getString("bytes", "");
        worker.execute(() -> {
            File temp = null;
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                // PdfRenderer needs a seekable descriptor, so the bytes have to
                // land on disk. In cacheDir, and deleted in the finally below:
                // a household's document must not outlive the read in the
                // clear, which is the whole reason the blob store is encrypted.
                temp = File.createTempFile("ocr", ".pdf", getContext().getCacheDir());
                try (FileOutputStream out = new FileOutputStream(temp)) {
                    out.write(bytes);
                }

                List<List<String>> out = new ArrayList<>();
                // One recogniser for the whole document. Built inside the loop
                // it was ten model loads for a ten-page scan.
                TextRecognizer recognizer =
                    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(
                        temp, ParcelFileDescriptor.MODE_READ_ONLY);
                     PdfRenderer renderer = new PdfRenderer(fd)) {

                    int count = Math.min(renderer.getPageCount(), MAX_PAGES);
                    for (int i = 0; i < count; i++) {
                        try (PdfRenderer.Page page = renderer.openPage(i)) {
                            Bitmap bitmap = render(page);
                            try {
                                List<String> lines = recognise(recognizer, bitmap);
                                if (!lines.isEmpty()) out.add(lines);
                            } finally {
                                bitmap.recycle();
                            }
                        }
                    }
                } finally {
                    recognizer.close();
                }
                call.resolve(pages(out));
            } catch (Exception failed) {
                call.reject(String.valueOf(failed.getMessage()));
            } finally {
                if (temp != null && !temp.delete()) temp.deleteOnExit();
            }
        });
    }

    /**
     * One page as a bitmap, white behind it.
     *
     * <p>A PDF page has no background of its own. Rendered onto the default
     * transparent bitmap, every unpainted pixel is black once flattened, and
     * black-on-black recognises as nothing — which reads exactly like a page
     * with no text on it.
     */
    private static Bitmap render(PdfRenderer.Page page) {
        float scale = Math.min(
            (float) RENDER_LONG_EDGE / Math.max(page.getWidth(), page.getHeight()), 4f);
        int width = Math.max(1, Math.round(page.getWidth() * scale));
        int height = Math.max(1, Math.round(page.getHeight() * scale));

        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(Color.WHITE);
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
        return bitmap;
    }

    /**
     * ML Kit, waited on — this already runs off the main thread.
     *
     * <p>The recogniser is passed in rather than built here. It was built here
     * first, which meant {@link #readPdf} loaded and tore down the model
     * <b>once per page</b>: on a ten-page scan that is ten model
     * initialisations to do ten seconds of recognition, and the loading is the
     * expensive half.
     */
    private static List<String> recognise(TextRecognizer recognizer, Bitmap bitmap)
            throws Exception {
        Text text = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)));
        List<String> lines = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                String value = line.getText().trim();
                if (!value.isEmpty()) lines.add(value);
            }
        }
        return lines;
    }

    /**
     * An image decoded small enough to survive.
     *
     * <p>Decoded at full size first, which is how a photograph gets read: a
     * twelve-megapixel picture is about <b>48 MB</b> as ARGB_8888, and the
     * files this feature exists for are camera photographs. On a mid-range
     * phone that is an OutOfMemoryError while filing a bill.
     *
     * <p>Two passes: bounds only, then a power-of-two subsample that brings the
     * long edge under {@link #RENDER_LONG_EDGE}. Recognition wants detail, not
     * megapixels — ML Kit asks for at least 1280x720 for small text, and 2000
     * is comfortably above it.
     */
    private static Bitmap decodeWithin(byte[] bytes, int longEdge) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

        int worst = Math.max(bounds.outWidth, bounds.outHeight);
        int sample = 1;
        while (worst / sample > longEdge) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    /** The shape `data/pdf-read.js` returns: `[{ lines: [...] }]`. */
    private static JSObject pages(List<List<String>> found) {
        JSArray out = new JSArray();
        for (List<String> lines : found) {
            JSObject page = new JSObject();
            JSArray asArray = new JSArray();
            for (String line : lines) asArray.put(line);
            page.put("lines", asArray);
            out.put(page);
        }
        JSObject result = new JSObject();
        result.put("pages", out);
        return result;
    }
}
