package me.rerere.rikkahub.ui.identity

/**
 * Who this device is acting as: whether an account is signed in, and whether it
 * is the administrator.
 *
 * This is an identity fact, not navigation vocabulary: which destinations each
 * may compose is declared by the destination catalog.
 */
data class IdentityScope(val signedIn: Boolean, val isAdmin: Boolean) {
    companion object {
        val SignedOut = IdentityScope(signedIn = false, isAdmin = false)
    }
}
