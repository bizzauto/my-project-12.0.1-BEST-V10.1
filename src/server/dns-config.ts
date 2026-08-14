/**
 * DNS resolution ordering for the deployment container.
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployment container has broken IPv6 egress: outbound IPv6 connections
 * silently time out (ETIMEDOUT), while IPv4 works perfectly. Google hosts
 * (oauth2.googleapis.com, www.googleapis.com, mybusiness*.googleapis.com)
 * resolve to BOTH an A (IPv4) and an AAAA (IPv6) record.
 *
 * Node 17+ defaults to "verbatim" DNS result ordering, which returns addresses
 * in the order the DNS server lists them — and for Google that is IPv6 first.
 * The app then attempts the IPv6 address, the connection times out, and the
 * Google Business Profile OAuth token exchange (and every GBP API call) fails
 * with a raw ETIMEDOUT / AggregateError even though the credentials and config
 * are correct.
 *
 * Forcing IPv4-first resolution makes Node prefer the working IPv4 path, which
 * fixes GBP connect end-to-end. This is safe everywhere: dual-stack hosts that
 * DO have working IPv6 still reach it via IPv4 as a fallback, and IPv4-only
 * environments are unaffected.
 *
 * This module must be the FIRST import in any entry point (server, worker) so
 * the ordering is set before any outbound connection is attempted.
 */
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

export {};
