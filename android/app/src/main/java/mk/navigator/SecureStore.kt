package mk.navigator

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import java.io.File

/** Map and profile, encrypted at rest with a hardware-backed Android Keystore key. No passphrase to type. */
class SecureStore(private val context: Context) {
    private val file = File(context.filesDir, "state.enc")

    private fun encrypted(): EncryptedFile {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedFile.Builder(context, file, key, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB).build()
    }

    @Synchronized
    fun save(json: String) {
        val tmp = File(context.filesDir, "state.tmp")
        if (tmp.exists()) tmp.delete()
        val enc = EncryptedFile.Builder(
            context, tmp,
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()
        enc.openFileOutput().use { it.write(json.toByteArray(Charsets.UTF_8)) }
        // Replace only after the new file is fully written, so a crash never loses the old map.
        if (file.exists()) file.delete()
        tmp.renameTo(file)
    }

    @Synchronized
    fun load(): String {
        if (!file.exists()) return ""
        return try {
            encrypted().openFileInput().use { String(it.readBytes(), Charsets.UTF_8) }
        } catch (e: Exception) {
            "" // unreadable (for example after a keystore reset): start with an empty map
        }
    }
}
